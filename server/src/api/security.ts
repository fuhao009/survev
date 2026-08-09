import { Config } from "../config.ts";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isUnsafeApiMethod(method: string) {
    return unsafeMethods.has(method.toUpperCase());
}

export function isAllowedApiOrigin(
    origin: string | undefined,
    allowedOrigins: readonly string[] = Config.security.allowedOrigins,
) {
    if (!origin) return false;
    return allowedOrigins.includes(origin);
}

export function shouldRejectApiOrigin(
    method: string,
    origin: string | undefined,
    options: {
        allowedOrigins?: readonly string[];
        isProduction?: boolean;
    } = {},
) {
    if (!isUnsafeApiMethod(method)) return false;
    if (!origin) return options.isProduction ?? process.env.NODE_ENV === "production";
    return !isAllowedApiOrigin(origin, options.allowedOrigins ?? Config.security.allowedOrigins);
}

export function apiCorsOrigin(origin: string) {
    return isAllowedApiOrigin(origin) ? origin : "";
}
