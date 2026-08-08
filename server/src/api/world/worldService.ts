import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MapDefs } from "../../../../shared/defs/mapDefs.ts";
import { GameObjectDefs } from "../../../../shared/defs/register.ts";
import {
    getInitialItemDurability,
    getRepairCost,
    isDamageWearItemType,
    isWeaponWearItemType,
    repairItem,
    wearItem,
} from "../../../../shared/types/itemDurability.ts";
import { parseItemInstance } from "../../../../shared/types/itemInstance.ts";
import type { ItemInstance } from "../../../../shared/types/itemInstance.ts";
import { getWorldExtractionQuote, getWorldExtractionZone } from "../../../../shared/types/world.ts";
import type {
    WorldCarriedItems,
    WorldCarriedItemsSnapshot,
    WorldExtractionZone,
    WorldLife,
    WorldSafeZone,
    WorldSettlementState,
    WorldShard,
} from "../../../../shared/types/world.ts";
import type { WorldActionResponse, WorldSnapshot } from "../../../../shared/types/worldApi.ts";
import { getWorldLightning } from "../../../../shared/types/worldLightning.ts";
import { getWorldTerrain, getWorldTerrainMovementModifier } from "../../../../shared/types/worldTerrain.ts";
import type { WorldTerrain } from "../../../../shared/types/worldTerrain.ts";
import { getWorldWeather } from "../../../../shared/types/worldWeather.ts";
import type { Loadout } from "../../../../shared/utils/loadout.ts";
import { Config } from "../../config.ts";
import { db } from "../db/index.ts";
import {
    usersTable,
    walletTransactionsTable,
    worldItemInstancesTable,
    worldLivesTable,
    worldSettlementsTable,
    worldShardsTable,
} from "../db/schema.ts";

const WORLD_ID = "gun-world";
const SHARD_ID = "gun-world-local-1";
const WORLD_SEED = "gun-world-seed-1";
const INITIAL_GEAR = ["ak47", "m9"] as const;
const INITIAL_EQUIPMENT = ["backpack01", "helmet01", "chest01"] as const;
const LOCKS = new Map<string, Promise<void>>();
const RECENT_EXTRACTION_WINDOW_MS = 15 * 60 * 1000;
const WORLD_DURABLE_GAME_OBJECT_TYPES = new Set([
    "gun",
    "melee",
    "helmet",
    "chest",
    "backpack",
    "outfit",
]);

const WORLD_ITEM_BASE_POINTS: Readonly<Record<string, number>> = {
    ak47: 42,
    m9: 14,
    fists: 0,
    backpack01: 8,
    helmet01: 10,
    chest01: 12,
    outfitBase: 2,
    crosshair_default: 1,
};

interface CompetitiveWorldMetrics {
    onlinePlayers: number;
    recentExtractions: number;
}

function withForUpdate<T>(query: T): T {
    if (Config.database.driver === "postgres") {
        return (query as T & { for: (mode: "update") => T }).for("update");
    }
    return query;
}

const safeZone: WorldSafeZone = {
    kind: "safe_zone",
    zoneId: "base-alpha",
    revision: 1,
    phase: "stable",
    current: { center: { x: 2048, y: 2048 }, radius: 1850 },
    target: null,
    outsideDamagePerSecond: 2,
};

const BASE_POSITION = { position: { ...safeZone.current.center }, layer: 0 } as const;

function worldItemBasePoints(
    item: Pick<typeof worldItemInstancesTable.$inferSelect, "type" | "durability" | "durabilityMax">,
) {
    const direct = WORLD_ITEM_BASE_POINTS[item.type];
    if (direct !== undefined) return direct;

    const def = GameObjectDefs.typeToDefSafe(item.type);
    if (!def) return 4;
    switch (def.type) {
        case "gun":
            return 34;
        case "melee":
            return 16;
        case "helmet":
        case "chest":
            return 14;
        case "backpack":
            return 10;
        case "outfit":
            return 5;
        case "scope":
            return 6;
        default:
            return item.durabilityMax > 0 ? 4 : 1;
    }
}

function durabilityRatio(item: Pick<typeof worldItemInstancesTable.$inferSelect, "durability" | "durabilityMax">) {
    if (item.durabilityMax <= 0) return 1;
    return Math.max(0, Math.min(1, item.durability / item.durabilityMax));
}

function worldDurableItemTypes(snapshot: WorldCarriedItemsSnapshot): Set<string> {
    const types = new Set<string>();
    for (const weapon of snapshot.weapons) {
        const def = GameObjectDefs.typeToDefSafe(weapon.itemType);
        if (def && (def.type === "gun" || def.type === "melee")) types.add(weapon.itemType);
    }
    for (
        const itemType of [
            snapshot.equipment.outfit,
            snapshot.equipment.backpack,
            snapshot.equipment.helmet,
            snapshot.equipment.chest,
        ]
    ) {
        const def = GameObjectDefs.typeToDefSafe(itemType);
        if (def && WORLD_DURABLE_GAME_OBJECT_TYPES.has(def.type)) types.add(itemType);
    }
    return types;
}

function isWithinExtractionZone(position: { x: number; y: number }, zone: WorldExtractionZone) {
    return Math.hypot(
        position.x - zone.center.x,
        position.y - zone.center.y,
    ) <= zone.radius;
}

function toWorldShard(row: typeof worldShardsTable.$inferSelect, now = Date.now()): WorldShard {
    const weather = getWorldWeather(row.seed, row.createdAt.getTime(), now);
    if (row.status !== "active") {
        return {
            kind: "world_shard",
            persistence: "persistent",
            shardId: row.shardId,
            worldId: row.worldId,
            mapId: row.mapId as WorldShard["mapId"],
            seed: row.seed,
            worldRevision: row.worldRevision,
            snapshotRevision: row.snapshotRevision,
            safeZone: row.safeZone,
            terrain: getWorldTerrain(row.seed, row.createdAt.getTime(), now),
            weather,
            lightning: getWorldLightning(row.seed, weather, now),
            createdAt: row.createdAt.getTime(),
            status: "closed",
            closedAt: row.updatedAt.getTime(),
            closeReason: "shutdown",
        };
    }
    return {
        kind: "world_shard",
        persistence: "persistent",
        shardId: row.shardId,
        worldId: row.worldId,
        mapId: row.mapId as WorldShard["mapId"],
        seed: row.seed,
        worldRevision: row.worldRevision,
        snapshotRevision: row.snapshotRevision,
        safeZone: row.safeZone,
        terrain: getWorldTerrain(row.seed, row.createdAt.getTime(), now),
        weather,
        lightning: getWorldLightning(row.seed, weather, now),
        createdAt: row.createdAt.getTime(),
        status: "active",
        lastHeartbeatAt: row.updatedAt.getTime(),
    };
}

function toWorldLife(row: typeof worldLivesTable.$inferSelect): WorldLife {
    const base = {
        kind: "world_life" as const,
        lifeId: row.lifeId,
        playerId: row.playerId,
        shardId: row.shardId,
        revision: row.revision,
        startedAt: row.startedAt,
    };
    if (row.status === "extracted") {
        const carriedItems = row.carriedItems as Extract<WorldCarriedItems, { state: "secured_on_extraction" }>;
        return {
            ...base,
            status: "extracted",
            extractedAt: row.extractedAt?.getTime() ?? row.updatedAt.getTime(),
            extractionId: carriedItems.extractionId,
            settlementId: "pending",
            carriedItems,
        };
    }
    if (row.status === "dead") {
        return {
            ...base,
            status: "dead",
            diedAt: row.diedAt?.getTime() ?? row.updatedAt.getTime(),
            cause: { kind: "environment", source: "unknown" },
            respawn: { status: "eligible", availableAt: row.updatedAt.getTime(), tokenId: row.lifeId },
            carriedItems: row.carriedItems as Extract<WorldCarriedItems, { state: "dropped_on_death" }>,
        };
    }
    return {
        ...base,
        status: "alive",
        position: row.position,
        health: row.health,
        boost: row.boost,
        carriedItems: row.carriedItems as Extract<WorldCarriedItems, { state: "carried" }>,
    };
}

function itemSnapshot(
    items: Array<typeof worldItemInstancesTable.$inferSelect>,
    ownerId: string,
    revision: number,
): WorldCarriedItemsSnapshot {
    const equippedType = (gameObjectType: string, fallback: string) =>
        items.find((item) => GameObjectDefs.typeToDefSafe(item.type)?.type === gameObjectType)?.type ?? fallback;
    return {
        kind: "carried_items_snapshot",
        ownerId,
        revision,
        stacks: [],
        weapons: items
            .filter((item) => ["ak47", "m9", "fists"].includes(item.type))
            .map((item) => ({
                itemType: item.type,
                slot: item.type === "fists"
                    ? "melee" as const
                    : item.type === "m9"
                    ? "secondary" as const
                    : "primary" as const,
                loadedAmmo: 0,
            })),
        equipment: {
            outfit: equippedType("outfit", "outfitBase"),
            backpack: equippedType("backpack", "backpack01"),
            helmet: equippedType("helmet", "helmet01"),
            chest: equippedType("chest", "chest01"),
            perks: [],
        },
    };
}

export class WorldService {
    private trace(event: string, payload?: unknown) {
        if (!Config.logging.debugLogs) return;
        if (payload === undefined) {
            console.debug("[debug][world]", event);
        } else {
            console.debug("[debug][world]", event, payload);
        }
    }

    private async withLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
        const previous = LOCKS.get(userId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => release = resolve);
        LOCKS.set(userId, previous.then(() => current));
        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (LOCKS.get(userId) === current) LOCKS.delete(userId);
        }
    }

    private async ensureShard() {
        await db.insert(worldShardsTable).values({
            shardId: SHARD_ID,
            worldId: WORLD_ID,
            mapId: MapDefs.main.mapId,
            seed: WORLD_SEED,
            safeZone,
        }).onConflictDoNothing();
        const row = await db.query.worldShardsTable.findFirst({ where: eq(worldShardsTable.shardId, SHARD_ID) });
        if (!row) throw new Error("world shard could not be initialized");
        return row;
    }

    async getTerrainSnapshot(): Promise<WorldTerrain> {
        const shard = await this.ensureShard();
        return toWorldShard(shard, Date.now()).terrain;
    }

    async getWorldRuntimeSnapshot() {
        const shard = await this.ensureShard();
        const world = toWorldShard(shard, Date.now());
        return {
            worldSeed: world.seed,
            terrain: world.terrain,
            weather: world.weather,
        };
    }

    private async ensureStarterItems(userId: string, loadout: Loadout) {
        const existing = await db.select().from(worldItemInstancesTable).where(
            and(
                eq(worldItemInstancesTable.userId, userId),
                inArray(worldItemInstancesTable.state, ["stash", "equipped"]),
            ),
        );
        const wanted = new Set<string>([
            ...INITIAL_GEAR,
            ...INITIAL_EQUIPMENT,
            loadout.outfit,
            loadout.melee,
            loadout.player_icon,
            loadout.crosshair.type,
        ].filter(Boolean));
        const existingTypes = new Set(existing.map((item) => item.type));
        const missing = [...wanted].filter((type) => !existingTypes.has(type));
        if (missing.length) {
            await db.insert(worldItemInstancesTable).values(missing.map((type) => ({
                instanceId: randomUUID(),
                userId,
                type,
                ...getInitialItemDurability(type),
                state: "stash",
            })));
        }
        return db.select().from(worldItemInstancesTable).where(
            and(
                eq(worldItemInstancesTable.userId, userId),
                inArray(worldItemInstancesTable.state, ["stash", "equipped"]),
            ),
        );
    }

    private async walletBalance(userId: string) {
        const result = await db.select({ balance: sql<number>`coalesce(sum(${walletTransactionsTable.amount}), 0)` })
            .from(walletTransactionsTable)
            .where(eq(walletTransactionsTable.userId, userId));
        return Number(result[0]?.balance ?? 0);
    }

    private async competitiveMetrics(shardId: string, now = Date.now()): Promise<CompetitiveWorldMetrics> {
        const online = await db.select({ count: sql<number>`count(*)` }).from(worldLivesTable).where(
            and(eq(worldLivesTable.shardId, shardId), eq(worldLivesTable.status, "alive")),
        );
        const recent = await db.select({ count: sql<number>`count(*)` }).from(worldSettlementsTable).where(
            and(
                eq(worldSettlementsTable.shardId, shardId),
                gte(worldSettlementsTable.createdAt, new Date(now - RECENT_EXTRACTION_WINDOW_MS)),
            ),
        );
        return {
            onlinePlayers: Number(online[0]?.count ?? 0),
            recentExtractions: Number(recent[0]?.count ?? 0),
        };
    }

    private buildExtractionQuote(
        life: typeof worldLivesTable.$inferSelect,
        carriedItems: Array<typeof worldItemInstancesTable.$inferSelect>,
        worldShard: WorldShard,
        extractionZone: WorldExtractionZone,
        metrics: CompetitiveWorldMetrics,
        now = Date.now(),
    ) {
        const quotedItems = carriedItems.filter((item) =>
            item.lifeId === life.lifeId && (item.state === "carried" || item.state === "equipped")
        );
        const baseItemPoints = quotedItems.reduce((total, item) => {
            return total + worldItemBasePoints(item) * durabilityRatio(item);
        }, 0);
        const durabilityAverage = quotedItems.length
            ? quotedItems.reduce((total, item) => total + durabilityRatio(item), 0) / quotedItems.length
            : 1;
        const terrainMovement = getWorldTerrainMovementModifier(
            extractionZone.center,
            worldShard.terrain,
            worldShard.weather,
        );
        return getWorldExtractionQuote({
            extractionZoneId: extractionZone.zoneId,
            extractionRevision: extractionZone.revision,
            updatedAt: now,
            baseItemPoints,
            durabilityRatio: durabilityAverage,
            lifeRevision: life.revision,
            elapsedMs: Math.max(0, now - life.startedAt),
            onlinePlayers: Math.max(1, metrics.onlinePlayers),
            recentExtractions: metrics.recentExtractions,
            weatherIntensity: worldShard.weather.intensity,
            terrainSpeedMultiplier: terrainMovement.speedMultiplier,
            lightningEventCount: worldShard.lightning.events.length,
        });
    }

    private async snapshot(userId: string, shardRow?: typeof worldShardsTable.$inferSelect): Promise<WorldSnapshot> {
        const shard = shardRow ?? await this.ensureShard();
        const now = Date.now();
        const worldShard = toWorldShard(shard, now);
        const extractionZone = getWorldExtractionZone(shard.seed, shard.createdAt.getTime(), now);
        const lifeRow = await db.query.worldLivesTable.findFirst({
            where: and(
                eq(worldLivesTable.playerId, userId),
                inArray(worldLivesTable.status, ["alive", "dead", "extracted"]),
            ),
            orderBy: [desc(worldLivesTable.updatedAt)],
        });
        if (!lifeRow) throw new Error("world life could not be loaded");
        const life = toWorldLife(lifeRow);
        const inventoryRows = await db.select().from(worldItemInstancesTable).where(
            eq(worldItemInstancesTable.userId, userId),
        );
        const inventory = inventoryRows.map((item) =>
            parseItemInstance({
                instanceId: item.instanceId,
                type: item.type,
                quantity: 1,
                durability: item.durability,
                durabilityMax: item.durabilityMax,
                state: item.state,
                ownerId: item.userId,
            })
        );
        const metrics = await this.competitiveMetrics(shard.shardId, now);
        const extractionQuote = lifeRow.status === "alive"
            ? this.buildExtractionQuote(lifeRow, inventoryRows, worldShard, extractionZone, metrics, now)
            : null;
        return {
            shard: worldShard,
            life,
            inventory,
            walletBalance: await this.walletBalance(userId),
            onlinePlayers: metrics.onlinePlayers,
            extractionZone,
            extractionQuote,
            canExtract: lifeRow.status === "alive" && isWithinExtractionZone(lifeRow.position.position, extractionZone),
            terrain: worldShard.terrain,
            terrainMovement: "position" in life
                ? getWorldTerrainMovementModifier(life.position.position, worldShard.terrain, worldShard.weather)
                : null,
            weather: worldShard.weather,
            lightning: worldShard.lightning,
        };
    }

    async enter(userId: string, loadout: Loadout, newLife = false): Promise<WorldSnapshot> {
        return this.withLock(userId, async () => {
            this.trace("enter:start", { userId, newLife });
            const shard = await this.ensureShard();
            const active = await db.query.worldLivesTable.findFirst({
                where: and(
                    eq(worldLivesTable.playerId, userId),
                    eq(worldLivesTable.shardId, SHARD_ID),
                    eq(worldLivesTable.status, "alive"),
                ),
            });
            if (active) {
                this.trace("enter:reuse-alive", {
                    userId,
                    lifeId: active.lifeId,
                    revision: active.revision,
                    health: active.health,
                    position: active.position,
                });
                return this.snapshot(userId, shard);
            }

            if (!newLife) {
                const latest = await db.query.worldLivesTable.findFirst({
                    where: and(eq(worldLivesTable.playerId, userId), eq(worldLivesTable.shardId, SHARD_ID)),
                    orderBy: [desc(worldLivesTable.updatedAt)],
                });
                if (latest) {
                    this.trace("enter:reuse-latest", {
                        userId,
                        lifeId: latest.lifeId,
                        status: latest.status,
                        revision: latest.revision,
                    });
                    return this.snapshot(userId, shard);
                }
            }

            const items = await this.ensureStarterItems(userId, loadout);
            const lifeId = randomUUID();
            this.trace("enter:create-life", {
                userId,
                lifeId,
                starterItemCount: items.length,
                loadout,
            });
            const carried = {
                state: "carried" as const,
                snapshot: itemSnapshot(items, userId, 1),
                capturedAt: Date.now(),
            } satisfies WorldCarriedItems;
            await db.insert(worldLivesTable).values({
                lifeId,
                playerId: userId,
                shardId: SHARD_ID,
                status: "alive",
                position: BASE_POSITION,
                carriedItems: carried,
                startedAt: Date.now(),
            });
            await db.update(worldItemInstancesTable).set({ state: "carried", lifeId, updatedAt: new Date() })
                .where(
                    and(
                        eq(worldItemInstancesTable.userId, userId),
                        inArray(worldItemInstancesTable.state, ["stash", "equipped"]),
                    ),
                );
            const snapshot = await this.snapshot(userId, shard);
            this.trace("enter:created", {
                userId,
                lifeId,
                snapshot: {
                    status: snapshot.life.status,
                    revision: snapshot.life.revision,
                    canExtract: snapshot.canExtract,
                    weather: snapshot.weather.type,
                },
            });
            return snapshot;
        });
    }

    async action(userId: string, action: WorldAction): Promise<WorldActionResponse> {
        return this.withLock(userId, async () => {
            this.trace("action:start", { userId, type: action.type, expectedRevision: action.expectedRevision });
            const shard = await this.ensureShard();
            const life = await db.query.worldLivesTable.findFirst({
                where: and(
                    eq(worldLivesTable.playerId, userId),
                    eq(worldLivesTable.shardId, SHARD_ID),
                    eq(worldLivesTable.status, "alive"),
                ),
            });
            if (!life) throw new WorldActionError("no_alive_life");
            if (action.expectedRevision !== undefined && action.expectedRevision !== life.revision) {
                this.trace("action:stale-revision", {
                    userId,
                    type: action.type,
                    expectedRevision: action.expectedRevision,
                    actualRevision: life.revision,
                });
                throw new WorldActionError("stale_revision");
            }
            let settlement: WorldSettlementState | undefined;
            if (action.type === "move") {
                const nextPosition = {
                    position: { x: Math.max(0, Math.min(4096, action.x)), y: Math.max(0, Math.min(4096, action.y)) },
                    layer: 0,
                };
                await db.update(worldLivesTable).set({
                    position: nextPosition,
                    revision: life.revision + 1,
                    updatedAt: new Date(),
                }).where(eq(worldLivesTable.lifeId, life.lifeId));
                this.trace("action:move", {
                    userId,
                    from: life.position,
                    to: nextPosition,
                });
            } else if (action.type === "fire") {
                const item = await db.query.worldItemInstancesTable.findFirst({
                    where: and(
                        eq(worldItemInstancesTable.instanceId, action.instanceId),
                        eq(worldItemInstancesTable.userId, userId),
                        eq(worldItemInstancesTable.lifeId, life.lifeId),
                    ),
                });
                if (!item) throw new WorldActionError("weapon_not_carried");
                if (!isWeaponWearItemType(item.type)) throw new WorldActionError("not_a_weapon");
                if (!(["carried", "equipped"] as string[]).includes(item.state)) {
                    throw new WorldActionError("weapon_not_carried");
                }
                const transition = wearItem(item);
                if (!transition.changed) throw new WorldActionError("item_destroyed");
                await db.update(worldItemInstancesTable).set({
                    durability: transition.durability,
                    state: transition.state,
                    updatedAt: new Date(),
                }).where(eq(worldItemInstancesTable.instanceId, item.instanceId));
                await db.update(worldLivesTable).set({ revision: life.revision + 1, updatedAt: new Date() }).where(
                    eq(worldLivesTable.lifeId, life.lifeId),
                );
                this.trace("action:fire", {
                    userId,
                    instanceId: action.instanceId,
                    itemType: item.type,
                    durability: transition.durability,
                    state: transition.state,
                });
            } else if (action.type === "damage") {
                await this.wearDamageEquipment(userId, life.lifeId);
                const health = Math.max(0, life.health - action.amount);
                if (health > 0) {
                    await db.update(worldLivesTable).set({ health, revision: life.revision + 1, updatedAt: new Date() })
                        .where(eq(worldLivesTable.lifeId, life.lifeId));
                    this.trace("action:damage", {
                        userId,
                        amount: action.amount,
                        cause: action.cause ?? "player",
                        health,
                    });
                } else {
                    this.trace("action:damage:dead", {
                        userId,
                        amount: action.amount,
                        cause: action.cause ?? "player",
                    });
                    await this.markDead(userId, life, action.cause ?? "player");
                }
            } else if (action.type === "extract") {
                const pos = life.position.position;
                const now = Date.now();
                const extractionZone = getWorldExtractionZone(shard.seed, shard.createdAt.getTime(), now);
                if (!isWithinExtractionZone(pos, extractionZone)) throw new WorldActionError("outside_extraction_zone");
                settlement = await this.extract(userId, life, shard, extractionZone, now);
                this.trace("action:extract", {
                    userId,
                    lifeId: life.lifeId,
                    settlementId: settlement.settlementId,
                    extractionZone,
                    rewards: settlement.status === "finalized" ? settlement.rewards : undefined,
                });
            } else if (action.type === "repair") {
                const repaired = await this.repair(userId, life.lifeId, action.instanceId);
                this.trace("action:repair", {
                    userId,
                    instanceId: action.instanceId,
                    repaired,
                });
            }
            const snapshot = await this.snapshot(userId, shard);
            this.trace("action:done", {
                userId,
                type: action.type,
                snapshot: {
                    status: snapshot.life.status,
                    revision: snapshot.life.revision,
                    health: snapshot.life.status === "alive" ? snapshot.life.health : undefined,
                    canExtract: snapshot.canExtract,
                },
                settlement: settlement?.status,
            });
            return { success: true, snapshot, settlement };
        });
    }

    async syncPositionForPlayer(userId: string, x: number, y: number, layer: number, health: number) {
        return this.withLock(userId, async () => {
            const life = await db.query.worldLivesTable.findFirst({
                where: and(
                    eq(worldLivesTable.playerId, userId),
                    eq(worldLivesTable.shardId, SHARD_ID),
                    eq(worldLivesTable.status, "alive"),
                ),
            });
            if (!life) return false;
            const shard = await this.ensureShard();
            const worldShard = toWorldShard(shard);

            const position = {
                position: {
                    x: Math.max(0, Math.min(4096, x)),
                    y: Math.max(0, Math.min(4096, y)),
                },
                layer: Math.trunc(layer),
            };
            // Death is persisted by the dedicated death callback. Keep a live
            // life above zero if the position heartbeat wins the race for the
            // tick in which the game marks the player dead.
            const nextHealth = Math.max(1, Math.min(100, Math.round(health)));
            const terrainMovement = getWorldTerrainMovementModifier(
                position.position,
                worldShard.terrain,
                worldShard.weather,
            );
            const unchanged = life.position.position.x === position.position.x
                && life.position.position.y === position.position.y
                && life.position.layer === position.layer
                && life.health === nextHealth;
            if (unchanged) {
                this.trace("position:unchanged", {
                    userId,
                    position,
                    health: nextHealth,
                    terrainMovement,
                });
                return terrainMovement;
            }

            await db.update(worldLivesTable).set({
                position,
                health: nextHealth,
                revision: life.revision + 1,
                updatedAt: new Date(),
            }).where(eq(worldLivesTable.lifeId, life.lifeId));
            this.trace("position:applied", {
                userId,
                previous: life.position,
                next: position,
                health: nextHealth,
                terrainMovement,
            });
            return terrainMovement;
        });
    }

    async syncInventoryForPlayer(userId: string, snapshot: WorldCarriedItemsSnapshot) {
        return this.withLock(userId, async () => {
            if (snapshot.ownerId !== userId) return false;

            return db.transaction(async (tx) => {
                const life = (await tx.select().from(worldLivesTable).where(
                    and(
                        eq(worldLivesTable.playerId, userId),
                        eq(worldLivesTable.shardId, SHARD_ID),
                        eq(worldLivesTable.status, "alive"),
                    ),
                ))[0];
                if (!life) return false;

                const desiredTypes = worldDurableItemTypes(snapshot);
                const currentItems = await tx.select().from(worldItemInstancesTable).where(
                    and(
                        eq(worldItemInstancesTable.userId, userId),
                        eq(worldItemInstancesTable.lifeId, life.lifeId),
                        inArray(worldItemInstancesTable.state, ["carried", "equipped"]),
                    ),
                );
                const retainedIds = new Set<string>();

                for (const type of desiredTypes) {
                    const existing = currentItems.find((item) =>
                        item.type === type && !retainedIds.has(item.instanceId)
                    );
                    if (existing) {
                        retainedIds.add(existing.instanceId);
                        continue;
                    }

                    await tx.insert(worldItemInstancesTable).values({
                        instanceId: randomUUID(),
                        userId,
                        lifeId: life.lifeId,
                        type,
                        ...getInitialItemDurability(type),
                        state: "carried",
                    });
                }

                const droppedIds = currentItems
                    .filter((item) => !retainedIds.has(item.instanceId) && !desiredTypes.has(item.type))
                    .map((item) => item.instanceId);
                if (droppedIds.length) {
                    await tx.update(worldItemInstancesTable).set({
                        state: "world",
                        lifeId: null,
                        updatedAt: new Date(),
                    }).where(inArray(worldItemInstancesTable.instanceId, droppedIds));
                }

                const nextRevision = life.revision + 1;
                const nextSnapshot: WorldCarriedItemsSnapshot = {
                    ...snapshot,
                    ownerId: userId,
                    revision: nextRevision,
                    stacks: snapshot.stacks.map((stack) => ({ ...stack })),
                    weapons: snapshot.weapons.map((weapon) => ({ ...weapon })),
                    equipment: {
                        ...snapshot.equipment,
                        perks: [...snapshot.equipment.perks],
                    },
                };
                await tx.update(worldLivesTable).set({
                    carriedItems: {
                        state: "carried",
                        snapshot: nextSnapshot,
                        capturedAt: Date.now(),
                    } satisfies WorldCarriedItems,
                    revision: nextRevision,
                    updatedAt: new Date(),
                }).where(eq(worldLivesTable.lifeId, life.lifeId));
                this.trace("inventory:applied", {
                    userId,
                    lifeId: life.lifeId,
                    revision: nextRevision,
                    createdTypes: [...desiredTypes].filter((type) => !currentItems.some((item) => item.type === type)),
                    droppedTypes: currentItems.filter((item) => droppedIds.includes(item.instanceId)).map((item) =>
                        item.type
                    ),
                });
                return true;
            });
        });
    }

    private async markDead(
        userId: string,
        life: typeof worldLivesTable.$inferSelect,
        cause: "player" | "safe_zone" | "fire" | "hazard",
    ) {
        this.trace("dead:start", {
            userId,
            lifeId: life.lifeId,
            cause,
        });
        const droppedAt = Date.now();
        const dropped = {
            state: "dropped_on_death" as const,
            snapshot: life.carriedItems.snapshot,
            dropId: randomUUID(),
            droppedAt,
        } satisfies WorldCarriedItems;
        await db.update(worldLivesTable).set({
            status: "dead",
            health: 0,
            carriedItems: dropped,
            revision: life.revision + 1,
            diedAt: new Date(droppedAt),
            updatedAt: new Date(),
        }).where(eq(worldLivesTable.lifeId, life.lifeId));
        await db.update(worldItemInstancesTable).set({ state: "world", updatedAt: new Date() }).where(
            and(
                eq(worldItemInstancesTable.userId, userId),
                eq(worldItemInstancesTable.lifeId, life.lifeId),
                inArray(worldItemInstancesTable.state, ["carried", "equipped"]),
            ),
        );
        await db.update(worldItemInstancesTable).set({ lifeId: null, updatedAt: new Date() }).where(
            and(eq(worldItemInstancesTable.userId, userId), eq(worldItemInstancesTable.lifeId, life.lifeId)),
        );
        this.trace("dead:done", {
            userId,
            lifeId: life.lifeId,
            cause,
        });
    }

    private async extract(
        userId: string,
        life: typeof worldLivesTable.$inferSelect,
        shard: typeof worldShardsTable.$inferSelect,
        extractionZone: WorldExtractionZone,
        now = Date.now(),
    ): Promise<WorldSettlementState> {
        this.trace("extract:start", {
            userId,
            lifeId: life.lifeId,
            revision: life.revision,
            extractionZone,
        });
        const extractionId = `${extractionZone.zoneId}:${life.lifeId}`;
        const settlementId = randomUUID();
        const secured = {
            state: "secured_on_extraction" as const,
            snapshot: life.carriedItems.snapshot,
            extractionId,
            securedAt: now,
        } satisfies WorldCarriedItems;
        const items = await db.select().from(worldItemInstancesTable).where(
            and(
                eq(worldItemInstancesTable.userId, userId),
                eq(worldItemInstancesTable.lifeId, life.lifeId),
            ),
        );
        const worldShard = toWorldShard(shard, now);
        const metrics = await this.competitiveMetrics(shard.shardId, now);
        const quote = this.buildExtractionQuote(life, items, worldShard, extractionZone, metrics, now);
        const rewardPoints = quote.totalPoints;
        let securedInventory: ItemInstance[] = [];
        await db.transaction(async (tx) => {
            securedInventory = items.map((item) =>
                parseItemInstance({
                    instanceId: item.instanceId,
                    type: item.type,
                    quantity: 1,
                    durability: item.durability,
                    durabilityMax: item.durabilityMax,
                    state: "stash",
                    ownerId: item.userId,
                })
            );
            await tx.insert(worldSettlementsTable).values({
                settlementId,
                playerId: userId,
                shardId: shard.shardId,
                lifeId: life.lifeId,
                extractionId,
                securedItems: secured,
                rewardPoints,
            });
            await tx.insert(walletTransactionsTable).values({
                userId,
                amount: rewardPoints,
                reason: "world_extraction",
            });
            await tx.update(worldLivesTable).set({
                status: "extracted",
                carriedItems: secured,
                extractedAt: new Date(),
                revision: life.revision + 1,
                updatedAt: new Date(),
            }).where(eq(worldLivesTable.lifeId, life.lifeId));
            await tx.update(worldItemInstancesTable).set({ state: "stash", lifeId: null, updatedAt: new Date() }).where(
                and(eq(worldItemInstancesTable.userId, userId), eq(worldItemInstancesTable.lifeId, life.lifeId)),
            );
        });
        const settlement: WorldSettlementState = {
            kind: "world_settlement",
            authority: "server",
            settlementId,
            playerId: userId,
            shardId: shard.shardId,
            lifeId: life.lifeId,
            extractionId,
            sourceWorldRevision: shard.worldRevision,
            sourceLifeRevision: life.revision,
            status: "finalized",
            finalizedAt: now,
            receiptId: settlementId,
            securedItems: secured,
            securedInventory,
            rewards: [{ rewardType: "points", quantity: rewardPoints, source: "dynamic_extraction_quote", quote }],
        };
        this.trace("extract:done", {
            userId,
            lifeId: life.lifeId,
            settlementId,
            rewardPoints,
            quote,
            securedInventoryCount: securedInventory.length,
        });
        return settlement;
    }

    private async repair(userId: string, lifeId: string, instanceId: string) {
        return db.transaction(async (tx) => {
            // Serialise wallet and repair mutations across API processes too;
            // the in-process user lock alone cannot protect a multi-instance deployment.
            await withForUpdate(tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)));
            const life = (await withForUpdate(
                tx.select({ status: worldLivesTable.status, revision: worldLivesTable.revision })
                    .from(worldLivesTable)
                    .where(eq(worldLivesTable.lifeId, lifeId)),
            ))[0];
            if (!life || life.status !== "alive") throw new WorldActionError("no_alive_life");
            const item = (await withForUpdate(
                tx.select().from(worldItemInstancesTable).where(
                    and(
                        eq(worldItemInstancesTable.instanceId, instanceId),
                        eq(worldItemInstancesTable.userId, userId),
                        eq(worldItemInstancesTable.lifeId, lifeId),
                    ),
                ),
            ))[0];
            if (!item) throw new WorldActionError("item_not_carried");
            if (!(["carried", "equipped", "destroyed"] as string[]).includes(item.state)) {
                throw new WorldActionError("item_not_repairable");
            }

            const cost = getRepairCost(item);
            if (cost === null) throw new WorldActionError("item_not_repairable");
            if (cost === 0) return false;

            const balance = await tx.select({
                balance: sql<number>`coalesce(sum(${walletTransactionsTable.amount}), 0)`,
            })
                .from(walletTransactionsTable)
                .where(eq(walletTransactionsTable.userId, userId));
            if (Number(balance[0]?.balance ?? 0) < cost) throw new WorldActionError("insufficient_points");

            const transition = repairItem(item);
            if (!transition.changed) return false;
            await tx.insert(walletTransactionsTable).values({ userId, amount: -cost, reason: "world_repair" });
            await tx.update(worldItemInstancesTable).set({
                durability: transition.durability,
                state: transition.state,
                updatedAt: new Date(),
            }).where(eq(worldItemInstancesTable.instanceId, instanceId));
            await tx.update(worldLivesTable).set({ revision: life.revision + 1, updatedAt: new Date() }).where(
                eq(worldLivesTable.lifeId, lifeId),
            );
            this.trace("repair:done", {
                userId,
                lifeId,
                instanceId,
                cost,
                durability: transition.durability,
                state: transition.state,
            });
            return true;
        });
    }

    private async wearDamageEquipment(userId: string, lifeId: string) {
        const items = await db.select().from(worldItemInstancesTable).where(
            and(
                eq(worldItemInstancesTable.userId, userId),
                eq(worldItemInstancesTable.lifeId, lifeId),
                inArray(worldItemInstancesTable.state, ["carried", "equipped"]),
            ),
        );
        let changed = 0;
        for (const item of items) {
            if (!isDamageWearItemType(item.type)) continue;
            const transition = wearItem(item);
            if (!transition.changed) continue;
            changed++;
            await db.update(worldItemInstancesTable).set({
                durability: transition.durability,
                state: transition.state,
                updatedAt: new Date(),
            }).where(eq(worldItemInstancesTable.instanceId, item.instanceId));
            this.trace("wear:damage", {
                userId,
                lifeId,
                instanceId: item.instanceId,
                itemType: item.type,
                durability: transition.durability,
                state: transition.state,
            });
        }
        return changed;
    }

    async wearDamageForPlayer(userId: string) {
        return this.withLock(userId, async () => {
            const life = await db.query.worldLivesTable.findFirst({
                where: and(
                    eq(worldLivesTable.playerId, userId),
                    eq(worldLivesTable.shardId, SHARD_ID),
                    eq(worldLivesTable.status, "alive"),
                ),
            });
            if (!life) return false;
            const changed = await this.wearDamageEquipment(userId, life.lifeId);
            if (changed > 0) {
                await db.update(worldLivesTable).set({
                    revision: life.revision + 1,
                    updatedAt: new Date(),
                }).where(eq(worldLivesTable.lifeId, life.lifeId));
            }
            this.trace("wear:damage-event", {
                userId,
                lifeId: life.lifeId,
                changed,
            });
            return changed > 0;
        });
    }

    async markDeadForPlayer(userId: string, cause: "player" | "safe_zone" | "fire" | "hazard") {
        return this.withLock(userId, async () => {
            await this.ensureShard();
            const life = await db.query.worldLivesTable.findFirst({
                where: and(
                    eq(worldLivesTable.playerId, userId),
                    eq(worldLivesTable.shardId, SHARD_ID),
                    eq(worldLivesTable.status, "alive"),
                ),
            });
            if (!life) return false;
            await this.markDead(userId, life, cause);
            return true;
        });
    }

    async wearWeaponForPlayer(userId: string, weaponType: string) {
        return this.withLock(userId, async () => {
            const life = await db.query.worldLivesTable.findFirst({
                where: and(
                    eq(worldLivesTable.playerId, userId),
                    eq(worldLivesTable.shardId, SHARD_ID),
                    eq(worldLivesTable.status, "alive"),
                ),
            });
            if (!life || !isWeaponWearItemType(weaponType)) return false;
            let item = await db.query.worldItemInstancesTable.findFirst({
                where: and(
                    eq(worldItemInstancesTable.userId, userId),
                    eq(worldItemInstancesTable.lifeId, life.lifeId),
                    eq(worldItemInstancesTable.type, weaponType),
                    inArray(worldItemInstancesTable.state, ["carried", "equipped"]),
                ),
            });
            if (!item) {
                const initial = getInitialItemDurability(weaponType);
                if (initial.durabilityMax <= 0) return false;
                await db.insert(worldItemInstancesTable).values({
                    instanceId: randomUUID(),
                    userId,
                    lifeId: life.lifeId,
                    type: weaponType,
                    ...initial,
                    state: "carried",
                });
                item = await db.query.worldItemInstancesTable.findFirst({
                    where: and(
                        eq(worldItemInstancesTable.userId, userId),
                        eq(worldItemInstancesTable.lifeId, life.lifeId),
                        eq(worldItemInstancesTable.type, weaponType),
                        inArray(worldItemInstancesTable.state, ["carried", "equipped"]),
                    ),
                });
            }
            if (!item) return false;
            const transition = wearItem(item);
            if (!transition.changed) return false;
            await db.update(worldItemInstancesTable).set({
                durability: transition.durability,
                state: transition.state,
                updatedAt: new Date(),
            }).where(eq(worldItemInstancesTable.instanceId, item.instanceId));
            await db.update(worldLivesTable).set({ revision: life.revision + 1, updatedAt: new Date() }).where(
                eq(worldLivesTable.lifeId, life.lifeId),
            );
            this.trace("wear:weapon", {
                userId,
                lifeId: life.lifeId,
                weaponType,
                instanceId: item.instanceId,
                durability: transition.durability,
                state: transition.state,
            });
            return true;
        });
    }
}

export type WorldAction =
    | { type: "move"; x: number; y: number; expectedRevision?: number }
    | { type: "fire"; instanceId: string; expectedRevision?: number }
    | { type: "damage"; amount: number; cause?: "player" | "safe_zone" | "fire" | "hazard"; expectedRevision?: number }
    | { type: "extract"; expectedRevision?: number }
    | { type: "repair"; instanceId: string; expectedRevision?: number };

export class WorldActionError extends Error {
    constructor(public readonly code: string) {
        super(code);
    }
}

export const worldService = new WorldService();
