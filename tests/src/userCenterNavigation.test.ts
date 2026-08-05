import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
    isUserCenterHash,
    resolveUserCenterReturnHash,
    USER_CENTER_HASH,
    USER_CENTER_RETURN_LABEL,
} from "../../client/src/ui/userCenterNavigation.ts";

const indexHtml = readFileSync(
    fileURLToPath(new URL("../../client/index.html", import.meta.url)),
    "utf8",
);
const statsHtml = readFileSync(
    fileURLToPath(new URL("../../client/stats/index.html", import.meta.url)),
    "utf8",
);

function anchorTagsWithClass(className: string): string[] {
    const pattern = new RegExp(`<a\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, "g");
    return indexHtml.match(pattern) ?? [];
}

describe("user center navigation contract", () => {
    test("resolves empty and illegal return targets to the account hub", () => {
        expect(resolveUserCenterReturnHash("")).toBe(USER_CENTER_HASH);
        expect(resolveUserCenterReturnHash("#")).toBe(USER_CENTER_HASH);
        expect(resolveUserCenterReturnHash("#unknown-panel")).toBe(USER_CENTER_HASH);
        expect(resolveUserCenterReturnHash("user-center")).toBe(USER_CENTER_HASH);
        expect(isUserCenterHash(USER_CENTER_HASH)).toBe(true);
        expect(isUserCenterHash("#unknown-panel")).toBe(false);
    });

    test("all account action anchors use an explicit return target", () => {
        for (
            const className of [
                "account-loadout-link",
                "account-stats-link",
                "btn-account-change-name",
                "btn-account-reset-stats",
                "btn-account-delete",
                "btn-account-logout",
            ]
        ) {
            const anchors = anchorTagsWithClass(className);
            expect(anchors.length, className).toBeGreaterThan(0);
            expect(anchors.every((anchor) => anchor.includes(`href="${USER_CENTER_HASH}"`)), className).toBe(true);
        }
    });

    test("subviews expose a visible Chinese return action and leaderboard has a hub link", () => {
        expect(indexHtml.match(/class="account-return-user-center"/g)?.length).toBe(4);
        expect(indexHtml.match(/data-l10n="home-return-user-center"/g)?.length).toBe(4);
        expect(indexHtml).toContain(USER_CENTER_RETURN_LABEL);
        expect(statsHtml).toContain("href=\"/#user-center\"");
    });
});
