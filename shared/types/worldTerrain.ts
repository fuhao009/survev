import type { Vec2 } from "../utils/v2.ts";

/** Terrain states are data-only until a later simulation task consumes them. */
export type WorldTerrainPatchType = "mud" | "flooded" | "rockslide" | "scorched";

export interface WorldTerrainPatchBounds {
    min: Vec2;
    max: Vec2;
}

export interface WorldTerrainPatch {
    readonly kind: "world_terrain_patch";
    /** Stable within a shard and terrain cycle. */
    id: string;
    type: WorldTerrainPatchType;
    bounds: WorldTerrainPatchBounds;
    /** 0..1 intensity reserved for later terrain interaction rules. */
    intensity: number;
    /** Authoritative patch revision, incremented when the cycle changes. */
    revision: number;
    updatedAt: number;
    expiresAt: number;
}

export interface WorldTerrain {
    readonly kind: "world_terrain";
    /** Monotonic terrain cycle revision within a shard. */
    revision: number;
    startedAt: number;
    endsAt: number;
    patches: readonly WorldTerrainPatch[];
}

export const WORLD_TERRAIN_CYCLE_DURATION_MS = 5 * 60 * 1000;
export const WORLD_TERRAIN_PATCH_COUNT = 4;
export const WORLD_TERRAIN_MAP_SIZE = 4096;

const TERRAIN_TYPES: readonly WorldTerrainPatchType[] = ["mud", "flooded", "rockslide", "scorched"];

function stableHash(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function boundedCoordinate(seed: string, cycle: number, patchIndex: number, axis: "x" | "y"): number {
    // Keep every generated center far enough from the edge for the largest
    // patch half-size, so all authoritative bounds stay inside the map.
    const margin = 400;
    const available = WORLD_TERRAIN_MAP_SIZE - margin * 2;
    return margin + stableHash(`${seed}:terrain:${cycle}:${patchIndex}:${axis}`) % available;
}

/**
 * Derive terrain only from immutable shard identity and time. A restart or a
 * second API worker therefore produces the same serializable snapshot.
 */
export function getWorldTerrain(seed: string, createdAt: number, now = Date.now()): WorldTerrain {
    const elapsed = Math.max(0, now - createdAt);
    const cycle = Math.floor(elapsed / WORLD_TERRAIN_CYCLE_DURATION_MS);
    const revision = cycle + 1;
    const startedAt = createdAt + cycle * WORLD_TERRAIN_CYCLE_DURATION_MS;
    const endsAt = startedAt + WORLD_TERRAIN_CYCLE_DURATION_MS;
    const firstType = stableHash(`${seed}:terrain:${cycle}:types`) % TERRAIN_TYPES.length;

    const patches = Array.from({ length: WORLD_TERRAIN_PATCH_COUNT }, (_, patchIndex) => {
        const centerX = boundedCoordinate(seed, cycle, patchIndex, "x");
        const centerY = boundedCoordinate(seed, cycle, patchIndex, "y");
        const width = 220 + stableHash(`${seed}:terrain:${cycle}:${patchIndex}:width`) % 520;
        const height = 180 + stableHash(`${seed}:terrain:${cycle}:${patchIndex}:height`) % 420;
        const halfWidth = Math.floor(width / 2);
        const halfHeight = Math.floor(height / 2);
        const intensity = 0.35 + (stableHash(`${seed}:terrain:${cycle}:${patchIndex}:intensity`) % 66) / 100;

        return {
            kind: "world_terrain_patch" as const,
            id: `terrain-${cycle}-${patchIndex}`,
            type: TERRAIN_TYPES[(firstType + patchIndex) % TERRAIN_TYPES.length],
            bounds: {
                min: { x: centerX - halfWidth, y: centerY - halfHeight },
                max: { x: centerX + halfWidth, y: centerY + halfHeight },
            },
            intensity,
            revision,
            updatedAt: startedAt,
            expiresAt: endsAt,
        } satisfies WorldTerrainPatch;
    });

    return {
        kind: "world_terrain",
        revision,
        startedAt,
        endsAt,
        patches,
    };
}
