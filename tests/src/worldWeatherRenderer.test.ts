import { describe, expect, test } from "vitest";
import {
    getWorldFogFalloffSampleAlpha,
    getWorldFogVisibilityState,
    getWorldLightningVisualState,
    getWorldTerrainPatchVisual,
    getWorldWeatherEmitterState,
} from "../../client/src/worldWeatherPresentation.ts";
import { getWorldLightning } from "../../shared/types/worldLightning.ts";

describe("world weather renderer state", () => {
    test("enables exterior rain and fog emitters by weather type and intensity", () => {
        expect(getWorldWeatherEmitterState({ type: "rain", intensity: 0.65 }, 0)).toMatchObject({
            rainEnabled: true,
            fogEnabled: false,
            rainRateMultiplier: 1,
        });
        expect(getWorldWeatherEmitterState({ type: "thunderstorm", intensity: 0.9 }, 0)).toMatchObject({
            rainEnabled: true,
            fogEnabled: true,
        });
        expect(getWorldWeatherEmitterState({ type: "fog", intensity: 0.7 }, 1)).toMatchObject({
            rainEnabled: false,
            fogEnabled: false,
        });
    });

    test("keeps fog clear around the player and fades distant visibility instead of covering the whole map", () => {
        const mild = getWorldFogVisibilityState({ type: "fog", intensity: 0.25 }, 0);
        const dense = getWorldFogVisibilityState({ type: "fog", intensity: 1 }, 0);

        expect(mild.enabled).toBe(true);
        expect(dense.clearRadius).toBeLessThan(mild.clearRadius);
        expect(dense.clearRadius).toBeGreaterThanOrEqual(20);
        expect(dense.fadeRadius).toBeGreaterThan(dense.clearRadius + 20);
        expect(dense.maxAlpha).toBeLessThan(0.65);

        expect(getWorldFogFalloffSampleAlpha(dense.clearRadius - 1, dense)).toBe(0);
        expect(getWorldFogFalloffSampleAlpha(dense.clearRadius + 8, dense)).toBeGreaterThan(0);
        expect(getWorldFogFalloffSampleAlpha(dense.fadeRadius + 10, dense)).toBe(dense.maxAlpha);
        expect(getWorldFogVisibilityState({ type: "fog", intensity: 1 }, 1).enabled).toBe(false);
    });

    test("makes rain and thunderstorm terrain patches visually stronger", () => {
        const base = getWorldTerrainPatchVisual("flooded", "clear", 0.8);
        const rain = getWorldTerrainPatchVisual("flooded", "rain", 0.8);
        const storm = getWorldTerrainPatchVisual("flooded", "thunderstorm", 0.8);

        expect(rain.alpha).toBeGreaterThan(base.alpha);
        expect(storm.alpha).toBeGreaterThan(rain.alpha);
        expect(getWorldTerrainPatchVisual("mud", "fog", 0.8).alpha).toBeLessThan(
            getWorldTerrainPatchVisual("mud", "clear", 0.8).alpha,
        );
    });

    test("derives deterministic lightning warning, active, and flash states", () => {
        const weather = {
            type: "thunderstorm" as const,
            phase: "stable" as const,
            intensity: 0.9,
            revision: 4,
            startedAt: 1_700_000_000_000,
            endsAt: 1_700_000_630_000,
            transitionProgress: 0,
            nextType: null,
        };
        const seed = "weather-renderer-test";
        const first = getWorldLightning(seed, weather, weather.startedAt).events[0];
        expect(first).toBeDefined();

        const warning = getWorldLightningVisualState(seed, weather, first!.strikeAt - 100);
        const active = getWorldLightningVisualState(seed, weather, first!.strikeAt + 40);
        const expired = getWorldLightningVisualState(seed, weather, first!.expiresAt);

        expect(warning.warningEvents.some((event) => event.eventId === first!.eventId)).toBe(true);
        expect(active.activeEvents.some((event) => event.eventId === first!.eventId)).toBe(true);
        expect(active.flashAlpha).toBeGreaterThan(0);
        expect(expired.activeEvents.some((event) => event.eventId === first!.eventId)).toBe(false);
    });
});
