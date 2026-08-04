import { describe, expect, test } from "vitest";
import { Game } from "../../server/src/game/game.ts";
import { DamageType, TeamMode } from "../../shared/gameConfig.ts";
import {
    getDefaultWorldTerrainBulletModifier,
    getWorldTerrainBulletModifier,
    type WorldTerrain,
    type WorldTerrainBulletModifier,
    type WorldTerrainPatch,
} from "../../shared/types/worldTerrain.ts";
import type { Vec2 } from "../../shared/utils/v2.ts";

class TerrainBulletTestGame extends Game {
    bulletModifier: WorldTerrainBulletModifier = getDefaultWorldTerrainBulletModifier({ x: 0, y: 0 });

    override getWorldBulletModifier(position: Vec2): WorldTerrainBulletModifier {
        return { ...this.bulletModifier, position: { ...position } };
    }
}

function terrainWithPatches(
    revision: number,
    patches: ReadonlyArray<Pick<WorldTerrainPatch, "id" | "type" | "bounds">>,
): WorldTerrain {
    return {
        kind: "world_terrain",
        revision,
        startedAt: 0,
        endsAt: 1,
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

function fireTestBullet(game: TerrainBulletTestGame) {
    return game.bulletBarn.fireBullet({
        bulletType: "bullet_mp5",
        gameSourceType: "mp5",
        pos: { x: 1000, y: 1000 },
        dir: { x: 1, y: 0 },
        layer: 0,
        damageMult: 1,
        damageType: DamageType.Player,
        playerId: 0,
    });
}

describe("authoritative terrain bullet effects", () => {
    test("keeps default bullet speed outside terrain patches", () => {
        const game = new TerrainBulletTestGame("bullet-default", {
            mapName: "main",
            teamMode: TeamMode.Solo,
            world: true,
        });

        const bullet = fireTestBullet(game);

        expect(bullet.baseSpeed).toBe(85);
        expect(bullet.speed).toBe(85);
    });

    test("changes actual server bullet speed inside a flooded patch", () => {
        const game = new TerrainBulletTestGame("bullet-flooded", {
            mapName: "main",
            teamMode: TeamMode.Solo,
            world: true,
        });
        const terrain = terrainWithPatches(4, [
            { id: "flooded", type: "flooded", bounds: { min: { x: 900, y: 900 }, max: { x: 1100, y: 1100 } } },
        ]);
        game.bulletModifier = getWorldTerrainBulletModifier({ x: 1000, y: 1000 }, terrain);

        const bullet = fireTestBullet(game);

        expect(game.bulletModifier.speedMultiplier).toBe(0.72);
        expect(bullet.speed).toBeCloseTo(85 * 0.72);
        expect(bullet.speed).not.toBe(bullet.baseSpeed);
    });

    test("uses stable restrictive rules for overlapping and boundary patches", () => {
        const patches = [
            { id: "mud", type: "mud", bounds: { min: { x: 0, y: 0 }, max: { x: 20, y: 20 } } },
            { id: "flooded", type: "flooded", bounds: { min: { x: 10, y: 10 }, max: { x: 30, y: 30 } } },
        ] as const;
        const position = { x: 10, y: 20 };
        const first = getWorldTerrainBulletModifier(position, terrainWithPatches(7, patches));
        const second = getWorldTerrainBulletModifier(position, terrainWithPatches(7, [...patches].reverse()));

        expect(first).toEqual(second);
        expect(first.matchedPatches.map((patch) => patch.id)).toEqual(["flooded", "mud"]);
        expect(first.speedMultiplier).toBe(0.72);
        expect(first.obstacleDamageMultiplier).toBe(0.6);
        expect(first.position).toEqual(position);
    });
});
