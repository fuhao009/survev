import fs from "node:fs";
import { platform } from "node:os";
import path from "node:path";
import { DamageType } from "../../../shared/gameConfig.ts";
import { gameMapPositionToWorld } from "../../../shared/types/world.ts";
import type { WorldCarriedItemsSnapshot } from "../../../shared/types/world.ts";
import type { WorldPositionSyncResponse, WorldPositionTerrainMovement } from "../../../shared/types/worldApi.ts";
import {
    getWorldLightning,
    getWorldLightningImpact,
    shouldApplyWorldLightningEvent,
} from "../../../shared/types/worldLightning.ts";
import {
    getWorldTerrainBulletModifier,
    getWorldTerrainLightningModifier,
    type WorldTerrain,
} from "../../../shared/types/worldTerrain.ts";
import type { WorldWeather } from "../../../shared/types/worldWeather.ts";
import { Logger } from "../../../shared/utils/logger.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";
import { Config } from "../config.ts";
import { apiPrivateRouter } from "../utils/apiRouter.ts";
import { logErrorToWebhook } from "../utils/logger.ts";
import type { SaveGameBody } from "../utils/types.ts";
import type { Client } from "./client.ts";
import { Game } from "./game.ts";
import { type ProcessMsg, ProcessMsgType } from "./ipcTypes.ts";
import { ClientSocket } from "./socket.ts";

function sendMsg(msg: ProcessMsg) {
    process.send!(msg);
}

process.on("disconnect", () => {
    process.exit();
});

let game: ServerGame | undefined;
let gameWeakRef: WeakRef<ServerGame> | undefined;
const socketIdToSocket = new Map<string, ProcessSocket<Client>>();

const procLogger = new Logger(Config.logging, `GameProc-${process.pid}`);

type WorldPositionUpdate = {
    userId: string;
    x: number;
    y: number;
    layer: number;
    health: number;
};

const pendingWorldPositions = new Map<string, WorldPositionUpdate>();
const worldMovementSpeedMultipliers = new Map<string, number>();
let worldTerrain: WorldTerrain | undefined;
let worldWeather: WorldWeather | undefined;
let worldSeed: string | undefined;
const lightningDamageRevisions = new Map<number, number>();
let worldPositionFlushTimer: ReturnType<typeof setTimeout> | undefined;

function normalizeWorldMovementSpeedMultiplier(value: number): number {
    return Number.isFinite(value) && value > 0 && value <= 1 ? value : 1;
}

function cacheWorldMovementSpeedMultipliers(updates: readonly WorldPositionTerrainMovement[]) {
    for (const update of updates) {
        worldMovementSpeedMultipliers.set(
            update.userId,
            normalizeWorldMovementSpeedMultiplier(update.terrainMovement.speedMultiplier),
        );
    }
}

function cacheWorldTerrain(terrain: WorldPositionSyncResponse["terrain"] | undefined) {
    if (terrain) worldTerrain = terrain;
}

function cacheWorldRuntime(response: WorldPositionSyncResponse) {
    cacheWorldTerrain(response.terrain);
    worldWeather = response.weather;
    worldSeed = response.worldSeed;
}

function scheduleWorldPositionFlush() {
    if (worldPositionFlushTimer) return;
    worldPositionFlushTimer = setTimeout(() => {
        worldPositionFlushTimer = undefined;
        void flushWorldPositions();
    }, 250);
}

async function flushWorldPositions() {
    if (pendingWorldPositions.size === 0) return;
    const updates = [...pendingWorldPositions.values()];
    pendingWorldPositions.clear();
    try {
        procLogger.debug("world position flush:start", {
            count: updates.length,
            sample: updates[0] ?? null,
        });
        const req = await apiPrivateRouter.world.position.$post({ json: { updates } });
        if (!req.ok) {
            procLogger.warn("Failed to persist world positions", await req.text());
        } else {
            const res = await req.json() as WorldPositionSyncResponse;
            cacheWorldMovementSpeedMultipliers(res.terrainMovement);
            cacheWorldRuntime(res);
            procLogger.debug("world position flush:done", {
                requested: updates.length,
                applied: res.applied,
                terrainMovement: res.terrainMovement,
                weather: res.weather,
                worldSeed: res.worldSeed,
            });
        }
    } catch (err) {
        procLogger.error("Failed to persist world positions", err);
    }
    if (pendingWorldPositions.size > 0) scheduleWorldPositionFlush();
}

function stopGame() {
    socketIdToSocket.clear();
    pendingWorldPositions.clear();
    worldMovementSpeedMultipliers.clear();
    worldTerrain = undefined;
    worldWeather = undefined;
    worldSeed = undefined;
    lightningDamageRevisions.clear();
    if (worldPositionFlushTimer) {
        clearTimeout(worldPositionFlushTimer);
        worldPositionFlushTimer = undefined;
    }
    game = undefined;

    // make sure game is properly free'd
    // we expose the gc on dev builds
    if (global.gc) {
        setImmediate(async () => {
            await global.gc!({
                execution: "async",
            });
            if (gameWeakRef?.deref()) {
                procLogger.warn("Possible memory leak found, something is keeping a reference to the game object!");
            }
        });
    }
}

//
// Keep saveGame and sendQuestProgress separated from the game class
// This ensures that waiting for the network request doesn't prevent the game instance from being GC'd
//

async function saveGame(gameId: string, values: SaveGameBody["matchData"]) {
    let res: Response | undefined = undefined;
    try {
        res = await apiPrivateRouter.save_game.$post({
            json: {
                matchData: values,
            },
        });
    } catch (err) {
        procLogger.error(`Failed to fetch API save game:`, err);
    }

    if (!res || !res.ok) {
        const region = Config.gameServer.thisRegion.toUpperCase();
        procLogger.error(
            `[${region}] Failed to save game data, saving locally instead`,
        );

        const dir = path.resolve("lost_game_data");
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
        fs.writeFileSync(
            path.join(dir, `${gameId}.json`),
            JSON.stringify(values),
            "utf8",
        );
    }
}

async function sendQuestProgress(userId: string, progress: Array<{ id: string; delta: number }>) {
    try {
        const req = await apiPrivateRouter.quest_progress.$post({
            json: {
                userId,
                progress,
            },
        });
        const res = await req.json();
        if (!req.ok || !(res as { success: boolean }).success) {
            procLogger.error(`Failed to save quest progress`, res);
        }
    } catch (err) {
        procLogger.error(`Failed to save quest progress:`, err);
    }
}

async function markWorldDeath(userId: string, cause: "player" | "safe_zone" | "fire" | "hazard") {
    try {
        const req = await apiPrivateRouter.world.death.$post({
            json: { userId, cause },
        });
        if (!req.ok) procLogger.warn("Failed to persist world death", await req.text());
    } catch (err) {
        procLogger.error("Failed to persist world death", err);
    }
}

async function markWorldFire(userId: string, weaponType: string) {
    try {
        const req = await apiPrivateRouter.world.fire.$post({
            json: { userId, weaponType },
        });
        if (!req.ok) procLogger.warn("Failed to persist world weapon wear", await req.text());
    } catch (err) {
        procLogger.error("Failed to persist world weapon wear", err);
    }
}

async function syncWorldInventory(userId: string, snapshot: WorldCarriedItemsSnapshot) {
    try {
        const req = await apiPrivateRouter.world.inventory.$post({
            json: {
                userId,
                snapshot: {
                    ...snapshot,
                    stacks: snapshot.stacks.map((stack) => ({ ...stack })),
                    weapons: snapshot.weapons.map((weapon) => ({ ...weapon })),
                    equipment: {
                        ...snapshot.equipment,
                        perks: [...snapshot.equipment.perks],
                    },
                },
            },
        });
        if (!req.ok) procLogger.warn("Failed to persist world inventory", await req.text());
    } catch (err) {
        procLogger.error("Failed to persist world inventory", err);
    }
}

async function markWorldDamage(userId: string) {
    try {
        const req = await apiPrivateRouter.world.damage.$post({
            json: { userId },
        });
        if (!req.ok) procLogger.warn("Failed to persist world equipment wear", await req.text());
    } catch (err) {
        procLogger.error("Failed to persist world equipment wear", err);
    }
}

/**
 * Implements methods only used when the game is actually running on a server
 */
class ServerGame extends Game {
    override getWorldMovementSpeedMultiplier(userId: string | null): number {
        if (!this.world || !userId) return 1;
        return worldMovementSpeedMultipliers.get(userId) ?? 1;
    }

    override getWorldBulletModifier(position: Vec2) {
        if (!this.world) return super.getWorldBulletModifier(position);
        return getWorldTerrainBulletModifier(position, worldTerrain);
    }

    override updateWorldHazards(_dt: number) {
        if (!this.world || !worldSeed || !worldWeather) return;

        const livingIds = new Set(this.playerBarn.livingPlayers.map((player) => player.__id));
        for (const playerId of lightningDamageRevisions.keys()) {
            if (!livingIds.has(playerId)) lightningDamageRevisions.delete(playerId);
        }

        const activeEvents = getWorldLightning(worldSeed, worldWeather, Date.now()).events.filter(
            (event) => event.phase === "active",
        );
        if (activeEvents.length === 0) return;

        for (const event of activeEvents) {
            // Damage can remove a player from livingPlayers, so iterate over a stable snapshot.
            for (const player of this.playerBarn.livingPlayers.slice()) {
                if (
                    player.dead
                    || !shouldApplyWorldLightningEvent(
                        lightningDamageRevisions.get(player.__id),
                        event.revision,
                    )
                ) continue;

                const terrainModifier = getWorldTerrainLightningModifier(player.pos, worldTerrain);
                const impact = getWorldLightningImpact(event, player.pos, terrainModifier);
                if (!impact) continue;

                lightningDamageRevisions.set(player.__id, event.revision);
                player.damage({
                    amount: impact.damage,
                    damageType: DamageType.Lightning,
                    dir: v2.normalizeSafe(v2.sub(player.pos, event.position)),
                });
            }
        }
    }

    override onPlayerDeath(userId: string | null, cause: "player" | "safe_zone" | "fire" | "hazard") {
        if (!this.world || !userId) return;
        worldMovementSpeedMultipliers.delete(userId);
        void markWorldDeath(userId, cause);
    }

    override onWeaponFired(userId: string | null, weaponType: string) {
        if (!this.world || !userId) return;
        void markWorldFire(userId, weaponType);
    }

    override onWorldPlayerInventoryChanged(userId: string | null, snapshot: WorldCarriedItemsSnapshot) {
        if (!this.world || !userId) return;
        void syncWorldInventory(userId, snapshot);
    }

    override onWorldPlayerDamaged(userId: string | null) {
        if (!this.world || !userId) return;
        void markWorldDamage(userId);
    }

    override onWorldPlayerUpdate(userId: string | null, x: number, y: number, layer: number, health: number) {
        if (!this.world || !userId) return;
        const worldPos = gameMapPositionToWorld({ x, y }, this.map.width, this.map.height);
        pendingWorldPositions.set(userId, { userId, x: worldPos.x, y: worldPos.y, layer, health });
        scheduleWorldPositionFlush();
    }

    override updateData() {
        sendMsg({
            type: ProcessMsgType.UpdateData,
            id: this.id,
            teamMode: this.teamMode,
            mapName: this.mapName,
            canJoin: this.canJoin,
            aliveCount: this.aliveCount,
            startedTime: this.startedTime,
            stopped: this.stopped,
            timeRunning: this.timeRunning,
            world: this.world,
        });
        if (this.stopped) {
            stopGame();
        }
    }

    override _saveGameToDatabase() {
        // don't save games that never started
        if (!this.started) return;

        const players = this.modeManager.getPlayersSortedByRank();
        /**
         * teamTotal is for total teams that started the match, i hope?
         *
         * it also seems to be unused by the client so we could also remove it?
         */
        const teamTotal = new Set(players.map(({ player }) => player.teamId)).size;

        const teamKills = players.reduce(
            (acc, curr) => {
                acc[curr.player.teamId] = (acc[curr.player.teamId] ?? 0) + curr.player.kills;
                return acc;
            },
            {} as Record<string, number>,
        );

        const values: SaveGameBody["matchData"] = players.map(({ player, rank }) => {
            return {
                // *NOTE: userId is optional; we save the game stats for non logged users too
                userId: player.userId,
                region: Config.gameServer.thisRegion,
                username: player.name,
                playerId: player.matchDataId,
                teamMode: this.teamMode,
                teamCount: player.group?.players.length ?? 1,
                teamTotal: teamTotal,
                teamId: player.teamId,
                timeAlive: Math.round(player.timeAlive),
                died: player.dead,
                kills: player.kills,
                team_kills: teamKills[player.groupId] ?? 0,
                damageDealt: Math.round(player.damageDealt),
                damageTaken: Math.round(player.damageTaken),
                killerId: player.killedBy?.matchDataId || 0,
                gameId: this.id,
                mapId: this.map.mapId,
                mapSeed: this.map.seed,
                killedIds: player.killedIds,
                rank: rank,
                ip: player.client.ip,
                findGameIp: player.client.findGameIp,
                role: player.role,
            };
        });

        // only save the game if it has more than 2 players lol
        if (values.length < 2) return;
        saveGame(this.id, values);
    }

    override sendQuestProgress(userId: string, progress: Array<{ id: string; delta: number }>) {
        sendQuestProgress(userId, progress);
    }
}

const socketMsgs: Array<{
    socketId: string;
    data: Uint8Array;
    ip: string;
}> = [];

class ProcessSocket<T extends object> extends ClientSocket<T> {
    private _id: string;
    private _ip: string;
    _closed = false;
    constructor(id: string, ip: string) {
        super();
        this._id = id;
        this._ip = ip;
    }

    ip(): string {
        return this._ip;
    }

    closed(): boolean {
        return this._closed;
    }

    send(data: Uint8Array<ArrayBuffer>): void {
        if (this.closed()) return;

        socketMsgs.push({
            socketId: this._id,
            data,
            ip: "",
        });
    }
    close(reason?: string): void {
        this._closed = true;
        sendMsg({
            type: ProcessMsgType.SocketClose,
            socketId: this._id,
            reason,
        });
        socketIdToSocket.delete(this._id);
    }
}

let lastMsgTime = Date.now();
process.on("message", (msg: ProcessMsg) => {
    if (msg.type) {
        lastMsgTime = Date.now();
    }

    if (msg.type === ProcessMsgType.Create && !game) {
        game = new ServerGame(msg.id, msg.config);
        gameWeakRef = new WeakRef(game);
    }

    if (!game) return;

    switch (msg.type) {
        case ProcessMsgType.AddJoinToken:
            game.addJoinTokens(msg.tokens, msg.autoFill);
            break;
        case ProcessMsgType.SocketOpen: {
            const socket = new ProcessSocket<Client>(msg.socketId, msg.ip);
            socketIdToSocket.set(msg.socketId, socket);
            break;
        }
        case ProcessMsgType.ClientSocketMsg: {
            const socket = socketIdToSocket.get(msg.socketId);
            if (socket) {
                game.clientBarn.handleMsg(msg.data as ArrayBuffer, socket);
            }
            break;
        }
        case ProcessMsgType.SocketClose: {
            const socket = socketIdToSocket.get(msg.socketId);
            if (socket) {
                socket._closed = true;
                game.clientBarn.handleSocketClose(socket);
                socketIdToSocket.delete(msg.socketId);
            }
            break;
        }
    }
});

setInterval(() => {
    if (Date.now() - lastMsgTime > 10000) {
        console.log("Game process has not received a message in 10 seconds, exiting");
        process.exit();
    }

    if (game) {
        game?.updateData();
    } else {
        sendMsg({
            type: ProcessMsgType.KeepAlive,
        });
    }
}, 5000);

let setGameInterval: (cb: () => void, time: number) => void = setInterval;
if (platform() === "win32") {
    const NanoTimer = (await import("nanotimer")).default;
    // setInterval on windows sucks
    // and doesn't give accurate timings
    setGameInterval = (cb: () => void, time: number) => {
        new NanoTimer().setInterval(cb, [], `${time}m`);
    };
}

setGameInterval(() => {
    game?.update();
}, 1000 / Config.gameTps);

setGameInterval(() => {
    game?.netSync();
    sendMsg({
        type: ProcessMsgType.ServerSocketMsg,
        msgs: socketMsgs,
    });
    socketMsgs.length = 0;
}, 1000 / Config.netSyncTps);

process.on("uncaughtException", async (err) => {
    console.error(err);
    game = undefined;

    await logErrorToWebhook("server", "Game process error", err);

    process.exit(1);
});
