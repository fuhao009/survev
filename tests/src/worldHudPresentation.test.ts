import { describe, expect, test } from "vitest";
import {
    buildWorldHudDurabilityGroups,
    getWorldHudDurabilityCount,
    getWorldHudLowestDurabilityPercent,
    getWorldWeatherVisualState,
} from "../../client/src/worldHudPresentation.ts";
import type { ItemInstance } from "../../shared/types/itemInstance.ts";

function item(
    type: string,
    state: ItemInstance["state"],
    durability: number,
    durabilityMax = 1000,
): ItemInstance {
    return {
        instanceId: `${type}-${state}`,
        type,
        quantity: 1,
        durability,
        durabilityMax,
        state,
        ownerId: "player-1",
    };
}

describe("world HUD presentation", () => {
    test("groups only carried and equipped durable items", () => {
        const groups = buildWorldHudDurabilityGroups([
            item("ak47", "carried", 1000),
            item("m9", "equipped", 910),
            item("outfitBase", "carried", 992),
            item("helmet01", "stash", 992),
            item("bandage", "carried", 0, 0),
        ]);

        expect(getWorldHudDurabilityCount(groups)).toBe(3);
        expect(getWorldHudLowestDurabilityPercent(groups)).toBe(91);
        expect(groups.map((group) => group.key)).toEqual(["weapon", "armor"]);
        expect(groups[0].items.map((item) => item.label)).toEqual(["AK-47", "M9 手枪"]);
        expect(groups[1].items.map((item) => item.label)).toEqual(["基础服装"]);
    });

    test("derives a visible visual state for each weather type", () => {
        expect(getWorldWeatherVisualState({
            type: "clear",
            phase: "stable",
            intensity: 0,
        })).toMatchObject({
            weatherClass: "world-weather-clear",
            hudWeatherClass: "world-hud-weather-clear",
            impactKey: "world-weather-impact-clear",
            overlayOpacity: 0,
            showOverlay: false,
        });

        expect(getWorldWeatherVisualState({
            type: "rain",
            phase: "stable",
            intensity: 0.65,
        })).toMatchObject({
            weatherClass: "world-weather-rain",
            hudWeatherClass: "world-hud-weather-rain",
            impactKey: "world-weather-impact-rain",
            overlayOpacity: 0.18,
            showOverlay: true,
        });

        expect(getWorldWeatherVisualState({
            type: "fog",
            phase: "stable",
            intensity: 0.7,
        })).toMatchObject({
            weatherClass: "world-weather-fog",
            hudWeatherClass: "world-hud-weather-fog",
            impactKey: "world-weather-impact-fog",
            overlayOpacity: 0,
            showOverlay: false,
        });

        expect(getWorldWeatherVisualState({
            type: "fog",
            phase: "warning",
            intensity: 0.7,
        })).toMatchObject({
            overlayOpacity: 0,
            showOverlay: false,
        });

        expect(getWorldWeatherVisualState({
            type: "thunderstorm",
            phase: "warning",
            intensity: 0.9,
        })).toMatchObject({
            weatherClass: "world-weather-thunderstorm",
            hudWeatherClass: "world-hud-weather-thunderstorm",
            impactKey: "world-weather-impact-thunderstorm",
            overlayOpacity: 0.3,
            showOverlay: true,
        });
    });
});
