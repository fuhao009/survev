import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { MapDefs } from "../../shared/defs/mapDefs.ts";

const rawIndexHtml = readFileSync(
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
const clientMapTs = readFileSync(
    fileURLToPath(new URL("../../client/src/map.ts", import.meta.url)),
    "utf8",
);
function stripProductionClientBlocks(code: string) {
    return code
        .replace(
            /\/\*\s*STRIP_FROM_PROD_CLIENT:START\s*\*\/[\s\S]*?\/\*\s*STRIP_FROM_PROD_CLIENT:END\s*\*\//g,
            "",
        )
        .replace(
            /<!--\s*STRIP_FROM_PROD_CLIENT:START\s*-->[\s\S]*?<!--\s*STRIP_FROM_PROD_CLIENT:END\s*-->/g,
            "",
        );
}

const indexHtml = stripProductionClientBlocks(rawIndexHtml);
const mapPlaceNames = [
    ...new Set(
        Object.values(MapDefs).flatMap((map: any) =>
            map?.mapGen?.places?.map((place: { name: string }) => place.name) ?? []
        ),
    ),
].sort();

const startMenuHtml = indexHtml.slice(indexHtml.indexOf("<div id=\"start-menu-wrapper\">"));
const worldHudHtml = indexHtml.slice(indexHtml.indexOf("<section id=\"world-hud\""));
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
    "index-durability-display",
    "index-durability-display-value",
    "index-durability-display-bar",
    "index-durability-display-hidden",
    "world-hud-title",
    "world-hud-collapse",
    "world-hud-expand",
    "world-hud-collapsed-summary",
    "world-life",
    "world-life-ended",
    "world-extraction-zone",
    "world-extraction-quote",
    "world-extraction-quote-unavailable",
    "world-weather",
    "world-weather-transition",
    "world-weather-hint",
    "world-weather-stable",
    "world-weather-impact-clear",
    "world-weather-impact-rain",
    "world-weather-impact-fog",
    "world-weather-impact-thunderstorm",
    "world-terrain-current",
    "world-terrain-normal",
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
    test("home launch surface only exposes the open world entry", () => {
        expect(indexHtml).toContain("id=\"btn-start-world\"");
        expect(indexHtml).toContain("data-l10n=\"home-start-world\"");
        expect(indexHtml).not.toContain("id=\"btn-start-mode-0\"");
        expect(indexHtml).not.toContain("id=\"btn-start-mode-1\"");
        expect(indexHtml).not.toContain("id=\"btn-start-mode-2\"");
        expect(indexHtml).not.toContain("id=\"btns-quick-start\"");
        expect(indexHtml).not.toContain("id=\"team-menu\"");
        expect(indexHtml).not.toContain("id=\"btn-join-team\"");
        expect(indexHtml).not.toContain("id=\"btn-create-team\"");
    });

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

    test("world hud actions stay outside the collapsible body", () => {
        const actionsIndex = worldHudHtml.indexOf("class=\"world-hud-actions\"");
        const bodyIndex = worldHudHtml.indexOf("class=\"world-hud-body\"");
        expect(actionsIndex).toBeGreaterThan(-1);
        expect(bodyIndex).toBeGreaterThan(-1);
        expect(actionsIndex).toBeLessThan(bodyIndex);
        expect(worldHudHtml).not.toContain("id=\"world-hud-gear\"");
    });

    test("map place names render through the Chinese map label adapter", () => {
        expect(clientMapTs).toContain("translateMapPlaceName(place.name)");
        expect(mapPlaceNames.filter((name) => {
            const quoted = `"${name}"`;
            return !clientMapTs.includes(`${quoted}:`) && !clientMapTs.includes(`${name}:`);
        })).toEqual([]);
        expect(clientMapTs).toContain("\"The Killpit\": \"杀戮坑\"");
        expect(clientMapTs).toContain("Riverside: \"河岸镇\"");
        expect(clientMapTs).toContain("\"Cordial Creek\": \"和风溪\"");
        expect(clientMapTs).not.toContain("new PIXI.Text(place.name");
    });
});
