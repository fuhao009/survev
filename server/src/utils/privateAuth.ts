import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Config } from "../config.ts";
import { fetchWithRetry } from "./fetchWithRetry.ts";

export const privateApiKeyHeader = "survev-api-key";
export const privateTimestampHeader = "survev-private-timestamp";
export const privateNonceHeader = "survev-private-nonce";
export const privateSignatureHeader = "survev-private-signature";

type HeaderGetter = (name: string) => string | undefined;

export type PrivateAuthFailureReason =
    | "ip_not_allowed"
    | "missing_timestamp"
    | "stale_timestamp"
    | "missing_nonce"
    | "nonce_replay"
    | "invalid_key"
    | "missing_signature"
    | "invalid_signature";

export type PrivateAuthResult =
    | { ok: true; ip?: string; keyIndex: number }
    | { ok: false; reason: PrivateAuthFailureReason; ip?: string };

export interface PrivateRequestInput {
    method: string;
    pathWithQuery: string;
    body?: string;
    ip?: string;
    header: HeaderGetter;
}

interface PrivateRequestVerificationOptions {
    allowedIps?: readonly string[];
    keys?: readonly string[];
    now?: number;
    signatureTtlMs?: number;
    nonceCacheMs?: number;
    nonceCache?: Map<string, number>;
}

const seenNonces = new Map<string, number>();

function normalizeIp(ip: string | undefined) {
    if (!ip) return undefined;
    return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

function privateKeys() {
    return [
        Config.secrets.SURVEV_API_KEY,
        Config.secrets.SURVEV_API_KEY_PREVIOUS,
    ].filter((key): key is string => !!key);
}

function safeEquals(left: string, right: string) {
    const rightBuffer = Buffer.from(right);
    if (rightBuffer.length === 0) return false;

    const leftBuffer = Buffer.from(left);
    if (leftBuffer.length !== rightBuffer.length) {
        const paddedLeft = Buffer.alloc(rightBuffer.length);
        leftBuffer.copy(paddedLeft, 0, 0, Math.min(leftBuffer.length, rightBuffer.length));
        timingSafeEqual(paddedLeft, rightBuffer);
        return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
}

export function privateApiKeyMatches(provided: string | undefined, expected = Config.secrets.SURVEV_API_KEY) {
    return !!provided && !!expected && safeEquals(provided, expected);
}

function bodyDigest(body = "") {
    return createHash("sha256").update(body).digest("hex");
}

function signaturePayload(
    input: Pick<PrivateRequestInput, "method" | "pathWithQuery" | "body">,
    timestamp: string,
    nonce: string,
) {
    return [
        input.method.toUpperCase(),
        input.pathWithQuery,
        timestamp,
        nonce,
        bodyDigest(input.body ?? ""),
    ].join("\n");
}

function signPayload(secret: string, payload: string) {
    return createHmac("sha256", secret).update(payload).digest("hex");
}

function isIpAllowed(ip: string | undefined, allowedIps: readonly string[]) {
    if (allowedIps.length === 0) return true;
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) return false;
    return allowedIps.map(normalizeIp).includes(normalizedIp);
}

function pruneNonceCache(cache: Map<string, number>, now: number) {
    for (const [nonce, expiresAt] of cache) {
        if (expiresAt <= now) cache.delete(nonce);
    }
}

export function createPrivateAuthHeaders(
    method: string,
    pathWithQuery: string,
    body = "",
    key = Config.secrets.SURVEV_API_KEY,
    now = Date.now(),
    nonce = randomUUID(),
) {
    const timestamp = String(now);
    const payload = signaturePayload({ method, pathWithQuery, body }, timestamp, nonce);
    return {
        [privateApiKeyHeader]: key,
        [privateTimestampHeader]: timestamp,
        [privateNonceHeader]: nonce,
        [privateSignatureHeader]: signPayload(key, payload),
    };
}

export function verifyPrivateRequest(
    input: PrivateRequestInput,
    options: PrivateRequestVerificationOptions = {},
): PrivateAuthResult {
    const now = options.now ?? Date.now();
    const allowedIps = options.allowedIps ?? Config.privateApi.allowedIps;
    const ip = normalizeIp(input.ip);
    if (!isIpAllowed(ip, allowedIps)) return { ok: false, reason: "ip_not_allowed", ip };

    const timestamp = input.header(privateTimestampHeader);
    if (!timestamp) return { ok: false, reason: "missing_timestamp", ip };
    const timestampMs = Number(timestamp);
    const signatureTtlMs = options.signatureTtlMs ?? Config.privateApi.signatureTtlMs;
    if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > signatureTtlMs) {
        return { ok: false, reason: "stale_timestamp", ip };
    }

    const nonce = input.header(privateNonceHeader);
    if (!nonce) return { ok: false, reason: "missing_nonce", ip };
    const nonceCache = options.nonceCache ?? seenNonces;
    const nonceCacheMs = options.nonceCacheMs ?? Config.privateApi.nonceCacheMs;
    pruneNonceCache(nonceCache, now);
    if (nonceCache.has(nonce)) return { ok: false, reason: "nonce_replay", ip };

    const providedKey = input.header(privateApiKeyHeader);
    const keys = options.keys ?? privateKeys();
    const keyIndex = keys.findIndex((key) => privateApiKeyMatches(providedKey, key));
    if (keyIndex < 0) return { ok: false, reason: "invalid_key", ip };

    const providedSignature = input.header(privateSignatureHeader);
    if (!providedSignature) return { ok: false, reason: "missing_signature", ip };

    const payload = signaturePayload(input, timestamp, nonce);
    if (!safeEquals(providedSignature, signPayload(keys[keyIndex], payload))) {
        return { ok: false, reason: "invalid_signature", ip };
    }

    nonceCache.set(nonce, now + nonceCacheMs);
    return { ok: true, ip, keyIndex };
}

export async function privateFetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
    const headers = new Headers(request.headers);
    for (
        const [key, value] of Object.entries(
            createPrivateAuthHeaders(request.method, `${url.pathname}${url.search}`, body),
        )
    ) {
        headers.set(key, value);
    }
    return fetchWithRetry(new Request(request, { headers }));
}
