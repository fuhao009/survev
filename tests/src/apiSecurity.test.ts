import { describe, expect, test } from "vitest";
import { apiCorsOrigin, isAllowedApiOrigin, shouldRejectApiOrigin } from "../../server/src/api/security.ts";

describe("browser API origin guard", () => {
    const allowedOrigins = ["https://survev.example", "https://api.survev.example"] as const;

    test("allows safe methods without an origin", () => {
        expect(shouldRejectApiOrigin("GET", undefined, { allowedOrigins, isProduction: true })).toBe(false);
        expect(shouldRejectApiOrigin("OPTIONS", undefined, { allowedOrigins, isProduction: true })).toBe(false);
    });

    test("rejects unsafe production requests with missing or unknown origins", () => {
        expect(shouldRejectApiOrigin("POST", undefined, { allowedOrigins, isProduction: true })).toBe(true);
        expect(
            shouldRejectApiOrigin("POST", "https://evil.example", { allowedOrigins, isProduction: true }),
        ).toBe(true);
    });

    test("allows unsafe requests from configured origins", () => {
        expect(
            shouldRejectApiOrigin("POST", "https://survev.example", { allowedOrigins, isProduction: true }),
        ).toBe(false);
        expect(isAllowedApiOrigin("https://api.survev.example", allowedOrigins)).toBe(true);
    });

    test("keeps local tooling usable outside production when origin is absent", () => {
        expect(shouldRejectApiOrigin("POST", undefined, { allowedOrigins, isProduction: false })).toBe(false);
    });

    test("does not emit wildcard CORS origins", () => {
        expect(apiCorsOrigin("https://evil.example")).toBe("");
    });
});
