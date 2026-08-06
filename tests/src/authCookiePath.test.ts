import { describe, expect, test } from "vitest";
import { clearAppDataCookie, setAppDataCookie } from "../../server/src/api/routes/user/auth/authUtils.ts";

type CookieContext = Parameters<typeof setAppDataCookie>[0];

function collectCookieHeaders(setup: (c: CookieContext) => void) {
    const headers: string[] = [];
    const c = {
        req: {
            raw: new Request("http://localhost/"),
        },
        header(name: string, value: string) {
            if (name.toLowerCase() === "set-cookie") {
                headers.push(value);
            }
        },
    } as unknown as CookieContext;

    setup(c);
    return headers;
}

describe("app-data cookie path", () => {
    test("sets app-data on the root path", () => {
        const [header = ""] = collectCookieHeaders((c) => setAppDataCookie(c));

        expect(header).toContain("app-data=1");
        expect(header.toLowerCase()).toContain("path=/");
    });

    test("clears app-data on the root path", () => {
        const [header = ""] = collectCookieHeaders((c) => clearAppDataCookie(c));

        expect(header).toContain("app-data=");
        expect(header.toLowerCase()).toContain("path=/");
    });
});
