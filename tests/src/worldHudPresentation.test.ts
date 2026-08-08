import { describe, expect, test } from "vitest";
import { getWorldWeatherVisualState } from "../../client/src/worldHudPresentation.ts";

describe("world HUD presentation", () => {
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
