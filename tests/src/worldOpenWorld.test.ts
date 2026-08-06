import { describe, expect, test } from "vitest";
import { GasMode, TeamMode } from "../../shared/gameConfig.ts";
import {
    WORLD_EXTRACTION_CYCLE_DURATION_MS,
    WORLD_MAP_SIZE,
    gameMapPositionToWorld,
    getWorldExtractionQuote,
    getWorldExtractionZone,
    worldPositionToGameMap,
} from "../../shared/types/world.ts";
import { Game } from "../../server/src/game/game.ts";

describe("open-world survival loop", () => {
    test("keeps big-world players out of battle-royale gas damage", () => {
        const game = new Game("world-open-test", {
            mapName: "main",
            teamMode: TeamMode.Solo,
            world: true,
        });
        const player = game.playerBarn.addTestPlayer({ userId: "world-player" });

        game.step(5);

        expect(game.gas.mode).toBe(GasMode.Inactive);
        expect(game.gas.isInGas(player.pos)).toBe(false);
        expect(player.health).toBe(100);
    });

    test("round-trips the persistent-world center through map sync", () => {
        const game = new Game("world-sync-test", {
            mapName: "main",
            teamMode: TeamMode.Solo,
            world: true,
        });

        const gamePos = worldPositionToGameMap({ x: 2048, y: 2048 }, game.map.width, game.map.height);
        expect(gamePos.x).toBeCloseTo(game.map.width / 2);
        expect(gamePos.y).toBeCloseTo(game.map.height / 2);
        expect(gameMapPositionToWorld(gamePos, game.map.width, game.map.height)).toEqual({
            x: 2048,
            y: 2048,
        });
    });

    test("derives a dynamic extraction point that refreshes by world cycle", () => {
        const createdAt = 1_700_000_000_000;
        const first = getWorldExtractionZone("gun-world-test", createdAt, createdAt + 1_000);
        const sameCycle = getWorldExtractionZone("gun-world-test", createdAt, createdAt + 60_000);
        const nextCycle = getWorldExtractionZone(
            "gun-world-test",
            createdAt,
            createdAt + WORLD_EXTRACTION_CYCLE_DURATION_MS + 1_000,
        );

        expect(first).toEqual(sameCycle);
        expect(nextCycle.zoneId).not.toBe(first.zoneId);
        expect(first.label).toBe("撤离点");
        expect(first.center.x).toBeGreaterThan(first.radius);
        expect(first.center.y).toBeGreaterThan(first.radius);
        expect(first.center.x).toBeLessThan(WORLD_MAP_SIZE - first.radius);
        expect(first.center.y).toBeLessThan(WORLD_MAP_SIZE - first.radius);
    });

    test("quotes extraction points from competitive dynamics instead of a fixed value", () => {
        const baseInput = {
            extractionZoneId: "extract-test",
            extractionRevision: 1,
            updatedAt: 1_700_000_000_000,
            baseItemPoints: 70,
            durabilityRatio: 1,
            lifeRevision: 6,
            elapsedMs: 180_000,
            onlinePlayers: 1,
            recentExtractions: 0,
            weatherIntensity: 0,
            terrainSpeedMultiplier: 1,
            lightningEventCount: 0,
        };

        const calm = getWorldExtractionQuote(baseInput);
        const contested = getWorldExtractionQuote({
            ...baseInput,
            onlinePlayers: 16,
            weatherIntensity: 0.9,
            terrainSpeedMultiplier: 0.55,
            lightningEventCount: 3,
        });
        const saturated = getWorldExtractionQuote({
            ...baseInput,
            recentExtractions: 10,
        });

        expect(contested.totalPoints).toBeGreaterThan(calm.totalPoints);
        expect(saturated.totalPoints).toBeLessThan(calm.totalPoints);
        expect(new Set([calm.totalPoints, contested.totalPoints, saturated.totalPoints]).size).toBe(3);
    });
});
