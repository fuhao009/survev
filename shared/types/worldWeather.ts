/** Weather state is derived from authoritative shard time and seed. */
export type WorldWeatherType = "clear" | "rain" | "fog" | "thunderstorm";

export type WorldWeatherPhase = "stable" | "warning";

export interface WorldWeather {
    readonly kind: "world_weather";
    type: WorldWeatherType;
    phase: WorldWeatherPhase;
    /** 0..1 target intensity for client effects and future terrain simulation. */
    intensity: number;
    /** Monotonic weather cycle revision within a shard. */
    revision: number;
    startedAt: number;
    endsAt: number;
    /** 0 while stable, then 0..1 during the transition warning. */
    transitionProgress: number;
    nextType: WorldWeatherType | null;
}

export const WORLD_WEATHER_STABLE_DURATION_MS = 10 * 60 * 1000;
export const WORLD_WEATHER_WARNING_DURATION_MS = 30 * 1000;
export const WORLD_WEATHER_CYCLE_DURATION_MS =
    WORLD_WEATHER_STABLE_DURATION_MS + WORLD_WEATHER_WARNING_DURATION_MS;

const WEATHER_INTENSITY: Record<WorldWeatherType, number> = {
    clear: 0,
    rain: 0.65,
    fog: 0.7,
    thunderstorm: 0.9,
};

function stableHash(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function weatherTypeForCycle(seed: string, cycle: number): WorldWeatherType {
    if (cycle <= 0) return "clear";
    const bucket = stableHash(`${seed}:${cycle}`) % 100;
    if (bucket < 45) return "clear";
    if (bucket < 70) return "rain";
    if (bucket < 88) return "fog";
    return "thunderstorm";
}

/**
 * Derive the current weather without mutable process state. This keeps every
 * API worker consistent after a restart while the shard seed and creation
 * time remain unchanged.
 */
export function getWorldWeather(seed: string, createdAt: number, now = Date.now()): WorldWeather {
    const elapsed = Math.max(0, now - createdAt);
    const revision = Math.floor(elapsed / WORLD_WEATHER_CYCLE_DURATION_MS) + 1;
    const startedAt = createdAt + (revision - 1) * WORLD_WEATHER_CYCLE_DURATION_MS;
    const cycleElapsed = Math.max(0, now - startedAt);
    const phase: WorldWeatherPhase = cycleElapsed >= WORLD_WEATHER_STABLE_DURATION_MS ? "warning" : "stable";
    const transitionProgress = phase === "warning"
        ? Math.min(
            1,
            (cycleElapsed - WORLD_WEATHER_STABLE_DURATION_MS) / WORLD_WEATHER_WARNING_DURATION_MS,
        )
        : 0;
    const type = weatherTypeForCycle(seed, revision - 1);

    return {
        kind: "world_weather",
        type,
        phase,
        intensity: WEATHER_INTENSITY[type],
        revision,
        startedAt,
        endsAt: startedAt + WORLD_WEATHER_CYCLE_DURATION_MS,
        transitionProgress,
        nextType: phase === "warning" ? weatherTypeForCycle(seed, revision) : null,
    };
}
