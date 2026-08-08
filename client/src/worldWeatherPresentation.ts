import type { WorldLightningEvent } from "../../shared/types/worldLightning.ts";
import { getWorldLightning } from "../../shared/types/worldLightning.ts";
import type { WorldTerrainPatchType } from "../../shared/types/worldTerrain.ts";
import type { WorldWeather, WorldWeatherType } from "../../shared/types/worldWeather.ts";

const LIGHTNING_WARNING_MS = 700;
const LIGHTNING_FLASH_ATTACK_MS = 80;
const LIGHTNING_FLASH_RELEASE_MS = 260;

const TERRAIN_COLORS: Record<WorldTerrainPatchType, number> = {
    mud: 0x725334,
    flooded: 0x3b82a6,
    rockslide: 0x766d64,
    scorched: 0x542c27,
};

export interface WorldWeatherEmitterState {
    rainEnabled: boolean;
    fogEnabled: boolean;
    rainRateMultiplier: number;
    fogRateMultiplier: number;
}

export interface WorldFogVisibilityState {
    enabled: boolean;
    clearRadius: number;
    fadeRadius: number;
    maxAlpha: number;
    color: number;
}

export interface WorldLightningVisualState {
    warningEvents: readonly WorldLightningEvent[];
    activeEvents: readonly WorldLightningEvent[];
    flashAlpha: number;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function smoothStep(value: number): number {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

export function getWorldWeatherEmitterState(
    weather: Pick<WorldWeather, "type" | "intensity"> | null,
    playerLayer: number,
): WorldWeatherEmitterState {
    if (!weather || playerLayer !== 0) {
        return {
            rainEnabled: false,
            fogEnabled: false,
            rainRateMultiplier: 1,
            fogRateMultiplier: 1,
        };
    }

    const rain = weather.type === "rain" || weather.type === "thunderstorm";
    const fog = weather.type === "fog" || weather.type === "thunderstorm";
    const intensity = Math.max(0.25, Math.min(1, weather.intensity));
    return {
        rainEnabled: rain,
        fogEnabled: fog,
        rainRateMultiplier: rain ? Math.max(0.65, 0.65 / intensity) : 1,
        fogRateMultiplier: fog ? Math.max(0.7, 0.7 / intensity) : 1,
    };
}

export function getWorldFogVisibilityState(
    weather: Pick<WorldWeather, "type" | "intensity"> | null,
    playerLayer: number,
): WorldFogVisibilityState {
    const emitterState = getWorldWeatherEmitterState(weather, playerLayer);
    if (!emitterState.fogEnabled || !weather) {
        return {
            enabled: false,
            clearRadius: 0,
            fadeRadius: 0,
            maxAlpha: 0,
            color: 0xdce7e3,
        };
    }

    const intensity = Math.max(0.25, Math.min(1, weather.intensity));
    const density = weather.type === "thunderstorm" ? intensity * 0.65 : intensity;
    const clearRadius = 28 - density * 8;
    const fadeRadius = 72 - density * 22;
    return {
        enabled: true,
        clearRadius,
        fadeRadius: Math.max(clearRadius + 22, fadeRadius),
        maxAlpha: 0.28 + density * 0.32,
        color: weather.type === "thunderstorm" ? 0xcddce4 : 0xdce7e3,
    };
}

export function getWorldFogFalloffSampleAlpha(
    distance: number,
    state: WorldFogVisibilityState,
): number {
    if (!state.enabled || distance <= state.clearRadius) return 0;
    if (distance >= state.fadeRadius) return state.maxAlpha;
    const progress = (distance - state.clearRadius) / (state.fadeRadius - state.clearRadius);
    return state.maxAlpha * smoothStep(progress);
}

export function getWorldTerrainPatchVisual(
    type: WorldTerrainPatchType,
    weatherType: WorldWeatherType,
    intensity: number,
) {
    const clampedIntensity = Math.max(0, Math.min(1, intensity));
    let alpha = 0.08 + clampedIntensity * 0.14;
    if (weatherType === "rain" && (type === "mud" || type === "flooded")) alpha *= 1.35;
    if (weatherType === "thunderstorm" && type === "flooded") alpha *= 1.45;
    if (weatherType === "fog") alpha *= 0.85;
    return {
        color: TERRAIN_COLORS[type],
        alpha: Math.min(0.38, alpha),
    };
}

export function getWorldLightningVisualState(
    worldSeed: string | null,
    weather: WorldWeather | null,
    now = Date.now(),
): WorldLightningVisualState {
    if (!worldSeed || !weather || weather.type !== "thunderstorm") {
        return {
            warningEvents: [],
            activeEvents: [],
            flashAlpha: 0,
        };
    }

    const events = getWorldLightning(worldSeed, weather, now).events;
    const warningEvents = events.filter(
        (event) => event.phase === "scheduled" && event.strikeAt - now <= LIGHTNING_WARNING_MS,
    );
    const activeEvents = events.filter((event) => event.phase === "active");
    let flashAlpha = 0;
    for (const event of activeEvents) {
        const age = now - event.strikeAt;
        const eventFlashAlpha = age < LIGHTNING_FLASH_ATTACK_MS
            ? 0.8 * (age / LIGHTNING_FLASH_ATTACK_MS)
            : Math.max(0, 0.8 * (1 - (age - LIGHTNING_FLASH_ATTACK_MS) / LIGHTNING_FLASH_RELEASE_MS));
        flashAlpha = Math.max(flashAlpha, eventFlashAlpha);
    }
    return { warningEvents, activeEvents, flashAlpha };
}
