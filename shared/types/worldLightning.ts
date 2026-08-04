import type { Vec2 } from "../utils/v2.ts";
import { getDefaultWorldTerrainLightningModifier, type WorldTerrainLightningModifier } from "./worldTerrain.ts";
import type { WorldWeather } from "./worldWeather.ts";

export type WorldLightningEventPhase = "scheduled" | "active";

export interface WorldLightningEvent {
    readonly kind: "world_lightning_event";
    readonly eventId: string;
    /** Stable event revision within the weather cycle. */
    readonly revision: number;
    readonly weatherRevision: number;
    readonly phase: WorldLightningEventPhase;
    readonly strikeAt: number;
    readonly expiresAt: number;
    readonly position: Vec2;
    readonly intensity: number;
    readonly radius: number;
    readonly damage: number;
}

export interface WorldLightning {
    readonly kind: "world_lightning";
    /** Matches the weather revision used to derive this schedule. */
    readonly revision: number;
    readonly weatherRevision: number;
    readonly events: readonly WorldLightningEvent[];
}

export const WORLD_LIGHTNING_LEAD_TIME_MS = 12_000;
export const WORLD_LIGHTNING_INTERVAL_MS = 45_000;
export const WORLD_LIGHTNING_DURATION_MS = 2_500;
export const WORLD_LIGHTNING_MAP_SIZE = 4096;
export const WORLD_LIGHTNING_MAP_MARGIN = 128;
export const WORLD_LIGHTNING_BASE_DAMAGE = 24;

function stableHash(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function normalizedHash(value: string): number {
    return stableHash(value) / 0xffffffff;
}

function eventFor(
    seed: string,
    weather: Pick<WorldWeather, "revision" | "startedAt" | "endsAt">,
    eventIndex: number,
    now: number,
): WorldLightningEvent | null {
    const eventSeed = `${seed}:lightning:${weather.revision}:${eventIndex}`;
    const jitter = Math.floor(normalizedHash(`${eventSeed}:jitter`) * 12_000);
    const strikeAt = weather.startedAt
        + WORLD_LIGHTNING_LEAD_TIME_MS
        + eventIndex * WORLD_LIGHTNING_INTERVAL_MS
        + jitter;
    if (strikeAt >= weather.endsAt) return null;

    const mapSpan = WORLD_LIGHTNING_MAP_SIZE - WORLD_LIGHTNING_MAP_MARGIN * 2;
    const position = {
        x: WORLD_LIGHTNING_MAP_MARGIN + Math.floor(normalizedHash(`${eventSeed}:x`) * mapSpan),
        y: WORLD_LIGHTNING_MAP_MARGIN + Math.floor(normalizedHash(`${eventSeed}:y`) * mapSpan),
    };
    const intensity = 0.6 + normalizedHash(`${eventSeed}:intensity`) * 0.4;
    const radius = 80 + Math.floor(normalizedHash(`${eventSeed}:radius`) * 100);
    const expiresAt = strikeAt + WORLD_LIGHTNING_DURATION_MS;
    if (expiresAt <= now) return null;

    return {
        kind: "world_lightning_event",
        eventId: `lightning-${weather.revision}-${eventIndex}`,
        revision: weather.revision * 1000 + eventIndex,
        weatherRevision: weather.revision,
        phase: now >= strikeAt ? "active" : "scheduled",
        strikeAt,
        expiresAt,
        position,
        intensity,
        radius,
        damage: WORLD_LIGHTNING_BASE_DAMAGE,
    };
}

/**
 * Derive the current lightning schedule from immutable shard/weather inputs.
 * Only thunderstorm weather can produce events; no client-side clock or
 * random state is needed to reproduce the server snapshot.
 */
export function getWorldLightning(
    seed: string,
    weather: Pick<WorldWeather, "type" | "phase" | "revision" | "startedAt" | "endsAt">,
    now = Date.now(),
): WorldLightning {
    if (weather.type !== "thunderstorm" || weather.phase !== "stable") {
        return {
            kind: "world_lightning",
            revision: weather.revision,
            weatherRevision: weather.revision,
            events: [],
        };
    }

    const events: WorldLightningEvent[] = [];
    for (let eventIndex = 0; eventIndex < 32; eventIndex++) {
        const event = eventFor(seed, weather, eventIndex, now);
        if (event) events.push(event);
        if (
            weather.startedAt + WORLD_LIGHTNING_LEAD_TIME_MS + eventIndex * WORLD_LIGHTNING_INTERVAL_MS
                >= weather.endsAt
        ) break;
    }

    return {
        kind: "world_lightning",
        revision: weather.revision,
        weatherRevision: weather.revision,
        events,
    };
}

export interface WorldLightningImpact {
    readonly eventRevision: number;
    readonly distance: number;
    readonly radius: number;
    readonly damage: number;
}

/** Event-revision gate used by the server tick to enforce one hit per strike. */
export function shouldApplyWorldLightningEvent(
    lastAppliedRevision: number | undefined,
    eventRevision: number,
): boolean {
    return lastAppliedRevision !== eventRevision;
}

/** Resolve one authoritative player hit without mutating game state. */
export function getWorldLightningImpact(
    event: Pick<WorldLightningEvent, "revision" | "position" | "radius" | "damage">,
    playerPosition: Vec2,
    terrainModifier: WorldTerrainLightningModifier = getDefaultWorldTerrainLightningModifier(playerPosition),
): WorldLightningImpact | null {
    const distance = Math.hypot(
        playerPosition.x - event.position.x,
        playerPosition.y - event.position.y,
    );
    const radius = event.radius * terrainModifier.radiusMultiplier;
    if (distance > radius) return null;

    return {
        eventRevision: event.revision,
        distance,
        radius,
        damage: event.damage * terrainModifier.damageMultiplier,
    };
}
