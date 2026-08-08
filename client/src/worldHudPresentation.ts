import type { WorldWeather, WorldWeatherType } from "../../shared/types/worldWeather.ts";

export const WORLD_WEATHER_LABELS: Record<WorldWeatherType, string> = {
    clear: "晴朗",
    rain: "降雨",
    fog: "浓雾",
    thunderstorm: "雷暴",
};

export const WORLD_TERRAIN_LABELS: Record<string, string> = {
    mud: "泥地",
    flooded: "积水地",
    rockslide: "落石区",
    scorched: "焦土区",
};

export const WORLD_WEATHER_TYPES = [
    "clear",
    "rain",
    "fog",
    "thunderstorm",
] as const satisfies readonly WorldWeatherType[];

export interface WorldWeatherVisualState {
    weatherClass: string;
    hudWeatherClass: string;
    impactKey: string;
    intensityPercent: number;
    riskPercent: number;
    overlayOpacity: number;
    showOverlay: boolean;
}

const WORLD_WEATHER_OVERLAY_OPACITY: Record<WorldWeatherType, number> = {
    clear: 0,
    rain: 0.18,
    // Fog visibility is rendered as a Pixi falloff around the local player.
    // A DOM overlay here turns it back into a uniform screen wash.
    fog: 0,
    thunderstorm: 0.3,
};

export function getWorldWeatherVisualState(
    weather: Pick<WorldWeather, "type" | "phase" | "intensity">,
): WorldWeatherVisualState {
    const intensityPercent = Math.round(Math.max(0, Math.min(1, weather.intensity)) * 100);
    const riskPercent = Math.round(Math.max(0, Math.min(1, weather.intensity)) * 22);
    const baseOverlayOpacity = WORLD_WEATHER_OVERLAY_OPACITY[weather.type];
    const overlayOpacity = weather.type === "fog"
        ? 0
        : weather.phase === "warning"
        ? Math.max(0.12, baseOverlayOpacity)
        : baseOverlayOpacity;
    return {
        weatherClass: `world-weather-${weather.type}`,
        hudWeatherClass: `world-hud-weather-${weather.type}`,
        impactKey: weather.type === "clear"
            ? "world-weather-impact-clear"
            : `world-weather-impact-${weather.type}`,
        intensityPercent,
        riskPercent,
        overlayOpacity,
        showOverlay: overlayOpacity > 0,
    };
}
