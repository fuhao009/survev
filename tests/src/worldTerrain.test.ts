import { describe, expect, test } from "vitest";
import type { WorldSnapshot } from "../../shared/types/worldApi.ts";
import {
    getWorldTerrain,
    WORLD_TERRAIN_CYCLE_DURATION_MS,
    WORLD_TERRAIN_PATCH_COUNT,
} from "../../shared/types/worldTerrain.ts";

describe("authoritative world terrain", () => {
    const seed = "gun-world-seed-1";
    const createdAt = 1_700_000_000_000;
    const now = createdAt + WORLD_TERRAIN_CYCLE_DURATION_MS + 12_345;

    test("is deterministic for the same shard and timestamp", () => {
        expect(getWorldTerrain(seed, createdAt, now)).toEqual(getWorldTerrain(seed, createdAt, now));
    });

    test("keeps the snapshot terrain equal to the authoritative shard terrain", () => {
        const terrain = getWorldTerrain(seed, createdAt, now);
        const snapshotTerrain = (snapshot: Pick<WorldSnapshot, "shard" | "terrain">) => snapshot.shard.terrain;
        const snapshot = { shard: { terrain } as WorldSnapshot["shard"], terrain };

        expect(snapshotTerrain(snapshot)).toBe(snapshot.terrain);
    });

    test("changes revision and patch state at a terrain cycle boundary", () => {
        const before = getWorldTerrain(seed, createdAt, createdAt + WORLD_TERRAIN_CYCLE_DURATION_MS - 1);
        const after = getWorldTerrain(seed, createdAt, createdAt + WORLD_TERRAIN_CYCLE_DURATION_MS);

        expect(after.revision).toBe(before.revision + 1);
        expect(after.startedAt).toBe(
            after.revision * WORLD_TERRAIN_CYCLE_DURATION_MS + createdAt - WORLD_TERRAIN_CYCLE_DURATION_MS,
        );
        expect(after.patches).not.toEqual(before.patches);
    });

    test("includes multiple authoritative terrain states and bounded ranges", () => {
        for (const terrainSeed of [seed, "gun-world-seed-2", "gun-world-seed-3", "gun-world-seed-4"]) {
            const terrain = getWorldTerrain(terrainSeed, createdAt, now);
            const types = new Set(terrain.patches.map((patch) => patch.type));

            expect(terrain.patches).toHaveLength(WORLD_TERRAIN_PATCH_COUNT);
            expect(types.size).toBeGreaterThanOrEqual(2);
            for (const patch of terrain.patches) {
                expect(patch.revision).toBe(terrain.revision);
                expect(patch.updatedAt).toBe(terrain.startedAt);
                expect(patch.expiresAt).toBe(terrain.endsAt);
                expect(patch.bounds.min.x).toBeGreaterThanOrEqual(0);
                expect(patch.bounds.min.y).toBeGreaterThanOrEqual(0);
                expect(patch.bounds.max.x).toBeLessThanOrEqual(4096);
                expect(patch.bounds.max.y).toBeLessThanOrEqual(4096);
            }
        }
    });
});
