import { describe, expect, test } from "vitest";
import { Game } from "../../server/src/game/game.ts";
import { TeamMode } from "../../shared/gameConfig.ts";
import type { WorldPositionSyncResponse, WorldSnapshot } from "../../shared/types/worldApi.ts";
import type { WorldTerrain, WorldTerrainPatch } from "../../shared/types/worldTerrain.ts";
import {
    getWorldTerrain,
    getWorldTerrainMovementModifier,
    WORLD_TERRAIN_CYCLE_DURATION_MS,
    WORLD_TERRAIN_PATCH_COUNT,
} from "../../shared/types/worldTerrain.ts";

class TerrainTestGame extends Game {
    multiplier = 1;

    override getWorldMovementSpeedMultiplier(userId: string | null): number {
        return userId ? this.multiplier : 1;
    }
}

function terrainWithPatches(
    revision: number,
    patches: ReadonlyArray<Pick<WorldTerrainPatch, "id" | "type" | "bounds">>,
): Pick<WorldTerrain, "revision" | "patches"> {
    return {
        revision,
        patches: patches.map((patch) => ({
            ...patch,
            kind: "world_terrain_patch" as const,
            intensity: 0.5,
            revision,
            updatedAt: 0,
            expiresAt: 1,
        })),
    };
}

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

    test("applies the shared speed rule for every terrain type", () => {
        const terrain = terrainWithPatches(7, [
            { id: "mud", type: "mud", bounds: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } } },
            { id: "flooded", type: "flooded", bounds: { min: { x: 20, y: 0 }, max: { x: 30, y: 10 } } },
            { id: "rockslide", type: "rockslide", bounds: { min: { x: 40, y: 0 }, max: { x: 50, y: 10 } } },
            { id: "scorched", type: "scorched", bounds: { min: { x: 60, y: 0 }, max: { x: 70, y: 10 } } },
        ]);

        expect(getWorldTerrainMovementModifier({ x: 5, y: 5 }, terrain).speedMultiplier).toBe(0.78);
        expect(getWorldTerrainMovementModifier({ x: 25, y: 5 }, terrain).speedMultiplier).toBe(0.55);
        expect(getWorldTerrainMovementModifier({ x: 45, y: 5 }, terrain).speedMultiplier).toBe(0.65);
        expect(getWorldTerrainMovementModifier({ x: 65, y: 5 }, terrain).speedMultiplier).toBe(0.9);
    });

    test("uses default speed outside patches and includes patch boundaries", () => {
        const terrain = terrainWithPatches(3, [
            { id: "mud-edge", type: "mud", bounds: { min: { x: 10, y: 10 }, max: { x: 20, y: 20 } } },
        ]);

        expect(getWorldTerrainMovementModifier({ x: 0, y: 0 }, terrain)).toMatchObject({
            speedMultiplier: 1,
            matchedPatches: [],
        });
        expect(getWorldTerrainMovementModifier({ x: 10, y: 20 }, terrain)).toMatchObject({
            speedMultiplier: 0.78,
            matchedPatches: [{ id: "mud-edge", type: "mud" }],
        });
        expect(getWorldTerrainMovementModifier({ x: 20.001, y: 20 }, terrain).matchedPatches).toEqual([]);
    });

    test("uses the slowest multiplier for overlapping patches and remains deterministic", () => {
        const patches = [
            { id: "mud", type: "mud", bounds: { min: { x: 0, y: 0 }, max: { x: 20, y: 20 } } },
            { id: "flooded", type: "flooded", bounds: { min: { x: 10, y: 10 }, max: { x: 30, y: 30 } } },
        ] as const;
        const terrain = terrainWithPatches(9, patches);
        const position = { x: 15, y: 15 };
        const first = getWorldTerrainMovementModifier(position, terrain);
        const second = getWorldTerrainMovementModifier(position, terrainWithPatches(9, [...patches].reverse()));

        expect(first).toEqual(second);
        expect(first.speedMultiplier).toBe(0.55);
        expect(first.matchedPatches.map((patch) => patch.id)).toEqual(["flooded", "mud"]);
        expect(first.terrainRevision).toBe(9);
        expect(first.position).toEqual(position);
    });

    test("derives a snapshot movement modifier from the authoritative life position", () => {
        const terrain = getWorldTerrain(seed, createdAt, now);
        const position = { x: 2048, y: 2048 };
        const snapshot = {
            terrain,
            life: { status: "alive", position },
            terrainMovement: getWorldTerrainMovementModifier(position, terrain),
        };

        expect(snapshot.terrainMovement.terrainRevision).toBe(snapshot.terrain.revision);
        expect(snapshot.terrainMovement.position).toEqual(snapshot.life.position);
        expect(snapshot.terrainMovement).toEqual(getWorldTerrainMovementModifier(position, snapshot.terrain));
    });

    test("applies the server-side terrain multiplier after normal player speed rules", () => {
        const game = new TerrainTestGame("terrain-speed-test", {
            mapName: "main",
            teamMode: TeamMode.Solo,
            world: true,
        });
        const player = game.playerBarn.addTestPlayer({ userId: "terrain-player" });

        player.recalculateSpeed(false);
        const normalSpeed = player.speed;

        game.multiplier = 0.55;
        player.recalculateSpeed(false);

        expect(normalSpeed).toBeGreaterThan(1);
        expect(player.speed).toBeCloseTo(normalSpeed * 0.55);
        expect(game.getWorldMovementSpeedMultiplier(null)).toBe(1);
    });

    test("keeps the applied count in the batched position response", () => {
        const response = {
            success: true,
            applied: 2,
            terrainMovement: [],
            terrain: {
                kind: "world_terrain" as const,
                revision: 3,
                startedAt: 0,
                endsAt: 1,
                patches: [],
            },
        } satisfies WorldPositionSyncResponse;

        expect(response.applied).toBe(2);
        expect(response.terrainMovement).toEqual([]);
    });
});
