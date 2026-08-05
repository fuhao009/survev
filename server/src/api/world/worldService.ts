import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import type {
    WorldCarriedItems,
    WorldCarriedItemsSnapshot,
    WorldLife,
    WorldSafeZone,
    WorldSettlementState,
    WorldShard,
} from "../../../../shared/types/world.ts";
import { WORLD_EXTRACTION_ZONE } from "../../../../shared/types/world.ts";
import type { WorldActionResponse, WorldSnapshot } from "../../../../shared/types/worldApi.ts";
import { getWorldLightning } from "../../../../shared/types/worldLightning.ts";
import { getWorldTerrain, getWorldTerrainMovementModifier } from "../../../../shared/types/worldTerrain.ts";
import type { WorldTerrain } from "../../../../shared/types/worldTerrain.ts";
import { getWorldWeather } from "../../../../shared/types/worldWeather.ts";
import type { Loadout } from "../../../../shared/utils/loadout.ts";
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
const BASE_POSITION = { position: { ...WORLD_EXTRACTION_ZONE.center }, layer: 0 } as const;
const INITIAL_GEAR = ["ak47", "m9"] as const;
const INITIAL_EQUIPMENT = ["backpack01", "helmet01", "chest01"] as const;
const LOCKS = new Map<string, Promise<void>>();

const safeZone: WorldSafeZone = {
    kind: "safe_zone",
    zoneId: "base-alpha",
    revision: 1,
    phase: "stable",
    current: { center: { x: 2048, y: 2048 }, radius: 1850 },
    target: null,
    outsideDamagePerSecond: 2,
};

function isWithinExtractionZone(position: { x: number; y: number }) {
    return Math.hypot(
        position.x - WORLD_EXTRACTION_ZONE.center.x,
        position.y - WORLD_EXTRACTION_ZONE.center.y,
    ) <= WORLD_EXTRACTION_ZONE.radius;
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
        return {
            ...base,
            status: "extracted",
            extractedAt: row.extractedAt?.getTime() ?? row.updatedAt.getTime(),
            extractionId: "base-alpha",
            settlementId: "pending",
            carriedItems: row.carriedItems as Extract<WorldCarriedItems, { state: "secured_on_extraction" }>,
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

    private async snapshot(userId: string, shardRow?: typeof worldShardsTable.$inferSelect): Promise<WorldSnapshot> {
        const shard = shardRow ?? await this.ensureShard();
        const worldShard = toWorldShard(shard);
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
        const online = await db.select({ count: sql<number>`count(*)` }).from(worldLivesTable).where(
            and(eq(worldLivesTable.shardId, shard.shardId), eq(worldLivesTable.status, "alive")),
        );
        return {
            shard: worldShard,
            life,
            inventory,
            walletBalance: await this.walletBalance(userId),
            onlinePlayers: Number(online[0]?.count ?? 0),
            extractionZone: WORLD_EXTRACTION_ZONE,
            canExtract: lifeRow.status === "alive" && isWithinExtractionZone(lifeRow.position.position),
            terrain: worldShard.terrain,
            terrainMovement: "position" in life
                ? getWorldTerrainMovementModifier(life.position.position, worldShard.terrain)
                : null,
            weather: worldShard.weather,
            lightning: worldShard.lightning,
        };
    }

    async enter(userId: string, loadout: Loadout, newLife = false): Promise<WorldSnapshot> {
        return this.withLock(userId, async () => {
            const shard = await this.ensureShard();
            const active = await db.query.worldLivesTable.findFirst({
                where: and(
                    eq(worldLivesTable.playerId, userId),
                    eq(worldLivesTable.shardId, SHARD_ID),
                    eq(worldLivesTable.status, "alive"),
                ),
            });
            if (active) return this.snapshot(userId, shard);

            if (!newLife) {
                const latest = await db.query.worldLivesTable.findFirst({
                    where: and(eq(worldLivesTable.playerId, userId), eq(worldLivesTable.shardId, SHARD_ID)),
                    orderBy: [desc(worldLivesTable.updatedAt)],
                });
                if (latest) return this.snapshot(userId, shard);
            }

            const items = await this.ensureStarterItems(userId, loadout);
            const lifeId = randomUUID();
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
            return this.snapshot(userId, shard);
        });
    }

    async action(userId: string, action: WorldAction): Promise<WorldActionResponse> {
        return this.withLock(userId, async () => {
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
            } else if (action.type === "damage") {
                await this.wearDamageEquipment(userId, life.lifeId);
                const health = Math.max(0, life.health - action.amount);
                if (health > 0) {
                    await db.update(worldLivesTable).set({ health, revision: life.revision + 1, updatedAt: new Date() })
                        .where(eq(worldLivesTable.lifeId, life.lifeId));
                } else {
                    await this.markDead(userId, life, action.cause ?? "player");
                }
            } else if (action.type === "extract") {
                const pos = life.position.position;
                if (!isWithinExtractionZone(pos)) throw new WorldActionError("outside_extraction_zone");
                settlement = await this.extract(userId, life, shard);
            } else if (action.type === "repair") {
                await this.repair(userId, life.lifeId, action.instanceId);
            }
            return { success: true, snapshot: await this.snapshot(userId, shard), settlement };
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
                toWorldShard(shard).terrain,
            );
            const unchanged = life.position.position.x === position.position.x
                && life.position.position.y === position.position.y
                && life.position.layer === position.layer
                && life.health === nextHealth;
            if (unchanged) return terrainMovement;

            await db.update(worldLivesTable).set({
                position,
                health: nextHealth,
                revision: life.revision + 1,
                updatedAt: new Date(),
            }).where(eq(worldLivesTable.lifeId, life.lifeId));
            return terrainMovement;
        });
    }

    private async markDead(
        userId: string,
        life: typeof worldLivesTable.$inferSelect,
        cause: "player" | "safe_zone" | "fire" | "hazard",
    ) {
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
    }

    private async extract(
        userId: string,
        life: typeof worldLivesTable.$inferSelect,
        shard: typeof worldShardsTable.$inferSelect,
    ): Promise<WorldSettlementState> {
        const extractionId = randomUUID();
        const settlementId = randomUUID();
        const secured = {
            state: "secured_on_extraction" as const,
            snapshot: life.carriedItems.snapshot,
            extractionId,
            securedAt: Date.now(),
        } satisfies WorldCarriedItems;
        const rewardPoints = Math.max(25, life.carriedItems.snapshot.weapons.length * 15 + life.revision);
        let securedInventory: ItemInstance[] = [];
        await db.transaction(async (tx) => {
            const items = await tx.select().from(worldItemInstancesTable).where(
                and(
                    eq(worldItemInstancesTable.userId, userId),
                    eq(worldItemInstancesTable.lifeId, life.lifeId),
                ),
            );
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
        return {
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
            finalizedAt: Date.now(),
            receiptId: settlementId,
            securedItems: secured,
            securedInventory,
            rewards: [{ rewardType: "points", quantity: rewardPoints }],
        };
    }

    private async repair(userId: string, lifeId: string, instanceId: string) {
        return db.transaction(async (tx) => {
            // Serialise wallet and repair mutations across API processes too;
            // the in-process user lock alone cannot protect a multi-instance deployment.
            await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)).for("update");
            const life = (await tx.select({ status: worldLivesTable.status, revision: worldLivesTable.revision })
                .from(worldLivesTable)
                .where(eq(worldLivesTable.lifeId, lifeId))
                .for("update"))[0];
            if (!life || life.status !== "alive") throw new WorldActionError("no_alive_life");
            const item = (await tx.select().from(worldItemInstancesTable).where(
                and(
                    eq(worldItemInstancesTable.instanceId, instanceId),
                    eq(worldItemInstancesTable.userId, userId),
                    eq(worldItemInstancesTable.lifeId, lifeId),
                ),
            ).for("update"))[0];
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
        for (const item of items) {
            if (!isDamageWearItemType(item.type)) continue;
            const transition = wearItem(item);
            if (!transition.changed) continue;
            await db.update(worldItemInstancesTable).set({
                durability: transition.durability,
                state: transition.state,
                updatedAt: new Date(),
            }).where(eq(worldItemInstancesTable.instanceId, item.instanceId));
        }
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
            const item = await db.query.worldItemInstancesTable.findFirst({
                where: and(
                    eq(worldItemInstancesTable.userId, userId),
                    eq(worldItemInstancesTable.lifeId, life.lifeId),
                    eq(worldItemInstancesTable.type, weaponType),
                    inArray(worldItemInstancesTable.state, ["carried", "equipped"]),
                ),
            });
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
