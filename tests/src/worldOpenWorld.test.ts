import { describe, expect, test } from "vitest";
import { GasMode, TeamMode } from "../../shared/gameConfig.ts";
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
});
