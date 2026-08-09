import { describe, expect, test } from "vitest";
import {
    createPrivateAuthHeaders,
    privateApiKeyHeader,
    privateApiKeyMatches,
    privateSignatureHeader,
    verifyPrivateRequest,
} from "../../server/src/utils/privateAuth.ts";

function headerGetter(headers: Record<string, string>) {
    return (name: string) => headers[name];
}

describe("private service authentication", () => {
    const key = "test-private-key-000000000000000000000000000";
    const previousKey = "test-previous-key-00000000000000000000000";
    const method = "POST";
    const pathWithQuery = "/private/world/inventory?region=local";
    const body = JSON.stringify({ userId: "player-1" });
    const now = 1_900_000_000_000;

    test("accepts signed private requests from allowed IPs", () => {
        const headers = createPrivateAuthHeaders(method, pathWithQuery, body, key, now, "nonce-1");
        const result = verifyPrivateRequest({
            method,
            pathWithQuery,
            body,
            ip: "127.0.0.1",
            header: headerGetter(headers),
        }, {
            allowedIps: ["127.0.0.1"],
            keys: [key],
            now,
            nonceCache: new Map(),
        });

        expect(result).toMatchObject({ ok: true });
    });

    test("rejects replayed nonces", () => {
        const headers = createPrivateAuthHeaders(method, pathWithQuery, body, key, now, "nonce-replay");
        const nonceCache = new Map<string, number>();
        const input = {
            method,
            pathWithQuery,
            body,
            ip: "127.0.0.1",
            header: headerGetter(headers),
        };

        expect(verifyPrivateRequest(input, { allowedIps: ["127.0.0.1"], keys: [key], now, nonceCache }))
            .toMatchObject({ ok: true });
        expect(verifyPrivateRequest(input, { allowedIps: ["127.0.0.1"], keys: [key], now, nonceCache }))
            .toEqual({ ok: false, reason: "nonce_replay", ip: "127.0.0.1" });
    });

    test("rejects stale timestamps and disallowed IPs", () => {
        const headers = createPrivateAuthHeaders(method, pathWithQuery, body, key, now - 61_000, "nonce-2");

        expect(verifyPrivateRequest({
            method,
            pathWithQuery,
            body,
            ip: "127.0.0.1",
            header: headerGetter(headers),
        }, {
            allowedIps: ["127.0.0.1"],
            keys: [key],
            now,
            signatureTtlMs: 60_000,
            nonceCache: new Map(),
        })).toEqual({ ok: false, reason: "stale_timestamp", ip: "127.0.0.1" });

        expect(verifyPrivateRequest({
            method,
            pathWithQuery,
            body,
            ip: "203.0.113.5",
            header: headerGetter(createPrivateAuthHeaders(method, pathWithQuery, body, key, now, "nonce-3")),
        }, {
            allowedIps: ["127.0.0.1"],
            keys: [key],
            now,
            nonceCache: new Map(),
        })).toEqual({ ok: false, reason: "ip_not_allowed", ip: "203.0.113.5" });
    });

    test("rejects tampered signatures and supports previous-key rotation", () => {
        const headers = createPrivateAuthHeaders(method, pathWithQuery, body, key, now, "nonce-4");
        headers[privateSignatureHeader] = `${headers[privateSignatureHeader].startsWith("0") ? "1" : "0"}${
            headers[privateSignatureHeader].slice(1)
        }`;
        expect(verifyPrivateRequest({
            method,
            pathWithQuery,
            body,
            ip: "::ffff:127.0.0.1",
            header: headerGetter(headers),
        }, {
            allowedIps: ["127.0.0.1"],
            keys: [key],
            now,
            nonceCache: new Map(),
        })).toEqual({ ok: false, reason: "invalid_signature", ip: "127.0.0.1" });

        const rotatedHeaders = createPrivateAuthHeaders(method, pathWithQuery, body, previousKey, now, "nonce-5");
        expect(verifyPrivateRequest({
            method,
            pathWithQuery,
            body,
            ip: "127.0.0.1",
            header: headerGetter(rotatedHeaders),
        }, {
            allowedIps: ["127.0.0.1"],
            keys: [key, previousKey],
            now,
            nonceCache: new Map(),
        })).toMatchObject({ ok: true, keyIndex: 1 });
    });

    test("does not accept missing or partial API keys", () => {
        expect(privateApiKeyMatches(key, key)).toBe(true);
        expect(privateApiKeyMatches(undefined, key)).toBe(false);
        expect(privateApiKeyMatches("", key)).toBe(false);
        expect(privateApiKeyMatches(key.slice(0, -1), key)).toBe(false);
        expect(privateApiKeyMatches(`${key.slice(0, -1)}x`, key)).toBe(false);

        const headers = createPrivateAuthHeaders(method, pathWithQuery, body, key, now, "nonce-6");
        headers[privateApiKeyHeader] = key.slice(0, -1);
        expect(verifyPrivateRequest({
            method,
            pathWithQuery,
            body,
            ip: "127.0.0.1",
            header: headerGetter(headers),
        }, {
            allowedIps: ["127.0.0.1"],
            keys: [key],
            now,
            nonceCache: new Map(),
        })).toEqual({ ok: false, reason: "invalid_key", ip: "127.0.0.1" });
    });
});
