import { describe, expect, test } from "vitest";
import { Config } from "../../server/src/config.ts";
import { Game } from "../../server/src/game/game.ts";
import { NoOpSocket } from "../../server/src/game/socket.ts";
import { TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";

function createWorldGame() {
    Config.logging.logDate = false;
    Config.logging.debugLogs = false;
    Config.logging.infoLogs = false;
    Config.logging.warnLogs = true;
    Config.logging.errorLogs = true;

    return new Game("reconnect-test", {
        mapName: "main",
        teamMode: TeamMode.Solo,
        world: true,
    });
}

function joinPlayer(game: Game, token: string, userId: string) {
    game.addJoinTokens([{
        token,
        userId,
        ip: "127.0.0.1",
    }], true);

    const socket = new NoOpSocket();
    const joinMsg = new net.JoinMsg();
    joinMsg.matchPriv = token;
    joinMsg.name = userId;

    const client = game.clientBarn.addClientWithPlayer(socket, joinMsg);
    if (!client?.player) throw new Error("Expected join to create or attach a player");
    return { client, player: client.player, socket };
}

function expectOnlyPlayer(game: Game, playerId: number) {
    expect(game.clientBarn.clients).toHaveLength(1);
    expect(game.clientBarn.clients[0].player?.__id).toBe(playerId);
    expect(game.playerBarn.players.map((player) => player.__id)).toEqual([playerId]);
    expect(game.playerBarn.livingPlayers.map((player) => player.__id)).toEqual([playerId]);
}

describe("player reconnect", () => {
    test("reattaches a reconnecting account to its existing alive player", () => {
        const game = createWorldGame();

        const first = joinPlayer(game, "first-token", "same-user");
        first.player.timeAlive = 20;
        first.socket.close();
        game.clientBarn.handleSocketClose(first.socket);

        expect(first.client.disconnected).toBe(true);
        expect(game.playerBarn.players).toHaveLength(1);

        const second = joinPlayer(game, "second-token", "same-user");
        const playerId = first.player.__id;

        expect(second.player.__id).toBe(playerId);
        expect(first.client.player).toBeUndefined();
        expect(second.client.player?.__id).toBe(playerId);
        expect(second.player.disconnected).toBe(false);
        expectOnlyPlayer(game, playerId);
    });

    test("replaces an already connected same-account socket without duplicating the player", () => {
        const game = createWorldGame();

        const first = joinPlayer(game, "first-token", "same-user");
        first.player.timeAlive = 20;

        const second = joinPlayer(game, "second-token", "same-user");
        const playerId = first.player.__id;

        expect(second.player.__id).toBe(playerId);
        expect(first.client.player).toBeUndefined();
        expect(first.client.disconnected).toBe(true);
        expect(first.socket.closed()).toBe(true);
        expect(second.client.player?.__id).toBe(playerId);
        expect(second.player.disconnected).toBe(false);
        expectOnlyPlayer(game, playerId);

        game.clientBarn.handleSocketClose(first.socket);

        expect(second.client.disconnected).toBe(false);
        expect(second.client.player?.__id).toBe(playerId);
        expectOnlyPlayer(game, playerId);
    });
});
