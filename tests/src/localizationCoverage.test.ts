import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const indexHtml = readFileSync(
    fileURLToPath(new URL("../../client/index.html", import.meta.url)),
    "utf8",
);
const english = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../client/src/en.json", import.meta.url)), "utf8"),
) as Record<string, string>;
const simplifiedChinese = JSON.parse(
    readFileSync(
        fileURLToPath(new URL("../../client/public/l10n/zh-cn.json", import.meta.url)),
        "utf8",
    ),
) as Record<string, string>;

const startMenuHtml = indexHtml.slice(indexHtml.indexOf("<div id=\"start-menu-wrapper\">"));
const startMenuKeys = [...startMenuHtml.matchAll(/data-l10n=['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .filter((key, index, keys) => keys.indexOf(key) === index);

const previouslyMissingStartKeys = [
    "index-customize-keybinds",
    "index-keybind-link",
    "index-keybind-paste",
    "index-keybind-apply",
    "game-share",
    "game-restore-defaults",
    "loadout-subcat",
    "loadout-stroke",
];

const dynamicPageKeys = [
    "account-overview",
    "account-wallet-points",
    "account-wallet-balance",
    "account-warehouse",
    "account-acquired-items",
    "account-world-gear",
    "account-latest-state",
    "account-refreshing",
    "account-refresh-success",
    "account-refresh-failed",
    "account-refresh",
    "account-no-world-items",
    "world-hud-title",
    "world-life",
    "world-life-ended",
    "world-weather",
    "world-weather-transition",
    "world-weather-hint",
    "world-weather-stable",
    "world-gear-empty",
    "world-extract",
    "world-return-user-center",
    "world-message-dead",
    "world-message-extracted",
    "world-message-extract-unavailable",
    "world-settlement-kicker",
    "world-result-reward-label",
    "world-result-wallet-before-label",
    "world-result-wallet-after-label",
    "world-settlement-extracted-title",
    "world-settlement-dead-title",
    "world-settlement-extracted-summary",
    "world-settlement-dead-summary",
    "world-settlement-items-extracted",
    "world-settlement-items-dropped",
    "world-settlement-warehouse-extracted",
    "world-settlement-warehouse-dead",
    "world-settlement-no-items-extracted",
    "world-settlement-no-items-dead",
    "world-settlement-consumable-detail",
    "world-settlement-settling",
    "world-settlement-unavailable",
    "world-settlement-extract-failed",
    "world-settlement-unknown-reason",
    "world-settlement-request-failed",
];

describe("Simplified Chinese page coverage", () => {
    test("all start-menu localization keys exist in zh-cn", () => {
        expect(startMenuKeys.filter(key => !(key in simplifiedChinese))).toEqual([]);
        expect(previouslyMissingStartKeys.filter(key => !(key in simplifiedChinese))).toEqual([]);
    });

    test("dynamic account and world states have Chinese translations", () => {
        expect(dynamicPageKeys.filter(key => !(key in simplifiedChinese))).toEqual([]);
        expect(dynamicPageKeys.filter(key => !simplifiedChinese[key]?.trim())).toEqual([]);
        expect(dynamicPageKeys.filter(key => simplifiedChinese[key] === english[key])).toEqual([]);
    });

    test("start-menu translations do not fall back to English", () => {
        const intentionalEnglish = new Set([
            "index-movement-ctrl",
            "index-swap-weapons-ctrl",
            "index-reload-ctrl",
            "index-pickup-ctrl",
            "index-cancel-action-ctrl",
            "index-toggle-minimap-ctrl",
        ]);
        expect(
            startMenuKeys.filter(key =>
                !simplifiedChinese[key]?.trim() || (
                    !intentionalEnglish.has(key) && simplifiedChinese[key] === english[key]
                )
            ),
        ).toEqual([]);
        expect(startMenuHtml).not.toContain(">Customize Keybinds<");
        expect(startMenuHtml).not.toContain(">Your IP has been banned.<");
        expect(startMenuHtml).not.toContain("placeholder=\"Paste a keybind code here\"");
    });

    test("selected page controls expose Chinese close and accessible labels", () => {
        const closeControls = [...startMenuHtml.matchAll(/<span[^>]*class="[^"]*\bclose\b[^"]*"[^>]*>/g)]
            .map(match => match[0]);
        expect(closeControls.length).toBeGreaterThanOrEqual(12);
        expect(closeControls.every(control => control.includes("data-l10n=\"index-close\""))).toBe(true);
        expect(closeControls.every(control => control.includes("data-l10n-attr=\"aria-label\""))).toBe(true);
        expect(closeControls.every(control => control.includes("aria-label=\"关闭\""))).toBe(true);
        expect(startMenuHtml).toContain("id=\"user-center-refresh\" type=\"button\" data-l10n=\"account-refresh\"");
        expect(startMenuHtml).toContain("aria-label=\"账号概览\"");
    });
});
