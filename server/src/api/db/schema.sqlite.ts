import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { TeamMode } from "../../../../shared/gameConfig.ts";
import type { WorldCarriedItems, WorldPosition, WorldSafeZone } from "../../../../shared/types/world.ts";
import { ItemStatus, type Loadout, loadout } from "../../../../shared/utils/loadout.ts";

export const sessionTable = sqliteTable("session", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => usersTable.id, {
            onDelete: "cascade",
            onUpdate: "cascade",
        }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export type SessionTableSelect = typeof sessionTable.$inferSelect;

export const usersTable = sqliteTable("users", {
    id: text("id").notNull().primaryKey(),
    authId: text("auth_id").notNull(),
    loginUsername: text("login_username").unique(),
    passwordHash: text("password_hash"),
    slug: text("slug").notNull().unique(),
    banned: integer("banned", { mode: "boolean" }).notNull().default(false),
    banReason: text("ban_reason").notNull().default(""),
    bannedBy: text("banned_by").notNull().default(""),
    username: text("username").notNull().default(""),
    nickname: text("nickname").notNull().default(""),
    usernameSet: integer("username_set", { mode: "boolean" }).notNull().default(false),
    userCreated: integer("user_created", { mode: "timestamp_ms" }).notNull().defaultNow(),
    lastUsernameChangeTime: integer("last_username_change_time", { mode: "timestamp_ms" }),
    linked: integer("linked", { mode: "boolean" }).notNull().default(false),
    linkedGoogle: integer("linked_google", { mode: "boolean" }).notNull().default(false),
    linkedDiscord: integer("linked_discord", { mode: "boolean" }).notNull().default(false),
    loadout: text("loadout", { mode: "json" })
        .notNull()
        .default(loadout.validate({} as Loadout))
        .$type<Loadout>(),
});

export type UsersTableInsert = typeof usersTable.$inferInsert;
export type UsersTableSelect = typeof usersTable.$inferSelect;

export const itemsTable = sqliteTable(
    "items",
    {
        userId: text("user_id")
            .notNull()
            .references(() => usersTable.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        type: text("type").notNull(),
        timeAcquired: integer("time_acquired").notNull(),
        source: text("source").notNull().default("unlock_new_account"),
        status: integer("status").notNull().default(ItemStatus.New),
    },
    (table) => [uniqueIndex("uq_items_user_type").on(table.userId, table.type)],
);
export const userPassTable = sqliteTable(
    "user_pass",
    {
        userId: text("user_id")
            .notNull()
            .references(() => usersTable.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        passType: text("pass_type").notNull().default("pass_survivr1"),
        totalXp: integer("total_xp").notNull().default(0),
        unlocks: text("unlocks", { mode: "json" }).notNull().default({}).$type<Record<string, boolean>>(),
        newItems: integer("new_items", { mode: "boolean" }).notNull().default(false),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex("user_pass_user_type").on(table.userId, table.passType)],
);

export type UserPassTableSelect = typeof userPassTable.$inferSelect;

export const walletTransactionsTable = sqliteTable(
    "wallet_transactions",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        userId: text("user_id")
            .notNull()
            .references(() => usersTable.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        amount: integer("amount").notNull(),
        reason: text("reason").notNull(),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    },
    (table) => [index("wallet_transactions_user_created_at_idx").on(table.userId, table.createdAt, table.id)],
);

export type WalletTransactionsTableSelect = typeof walletTransactionsTable.$inferSelect;

export const worldShardsTable = sqliteTable("world_shards", {
    shardId: text("shard_id").primaryKey(),
    worldId: text("world_id").notNull(),
    mapId: integer("map_id").notNull(),
    seed: text("seed").notNull(),
    status: text("status").notNull().default("active"),
    worldRevision: integer("world_revision").notNull().default(0),
    snapshotRevision: integer("snapshot_revision").notNull().default(0),
    safeZone: text("safe_zone", { mode: "json" }).notNull().$type<WorldSafeZone>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
});

export type WorldShardsTableSelect = typeof worldShardsTable.$inferSelect;

export const worldLivesTable = sqliteTable(
    "world_lives",
    {
        lifeId: text("life_id").primaryKey(),
        playerId: text("player_id")
            .notNull()
            .references(() => usersTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
        shardId: text("shard_id")
            .notNull()
            .references(() => worldShardsTable.shardId, { onDelete: "cascade", onUpdate: "cascade" }),
        status: text("status").notNull().default("alive"),
        revision: integer("revision").notNull().default(1),
        position: text("position", { mode: "json" }).notNull().$type<WorldPosition>(),
        health: integer("health").notNull().default(100),
        boost: integer("boost").notNull().default(0),
        carriedItems: text("carried_items", { mode: "json" }).notNull().$type<WorldCarriedItems>(),
        startedAt: integer("started_at").notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
        diedAt: integer("died_at", { mode: "timestamp_ms" }),
        extractedAt: integer("extracted_at", { mode: "timestamp_ms" }),
    },
    (table) => [
        index("world_lives_player_status_idx").on(table.playerId, table.status),
        index("world_lives_shard_status_idx").on(table.shardId, table.status),
    ],
);

export type WorldLivesTableSelect = typeof worldLivesTable.$inferSelect;

export const worldItemInstancesTable = sqliteTable(
    "world_item_instances",
    {
        instanceId: text("instance_id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => usersTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
        lifeId: text("life_id").references(() => worldLivesTable.lifeId, { onDelete: "set null" }),
        type: text("type").notNull(),
        quantity: integer("quantity").notNull().default(1),
        durability: integer("durability").notNull(),
        durabilityMax: integer("durability_max").notNull(),
        state: text("state").notNull().default("stash"),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    },
    (table) => [
        index("world_item_instances_user_state_idx").on(table.userId, table.state),
        index("world_items_life_idx").on(table.lifeId),
    ],
);

export type WorldItemInstancesTableSelect = typeof worldItemInstancesTable.$inferSelect;

export const worldSettlementsTable = sqliteTable(
    "world_settlements",
    {
        settlementId: text("settlement_id").primaryKey(),
        playerId: text("player_id")
            .notNull()
            .references(() => usersTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
        shardId: text("shard_id")
            .notNull()
            .references(() => worldShardsTable.shardId, { onDelete: "cascade", onUpdate: "cascade" }),
        lifeId: text("life_id")
            .notNull()
            .references(() => worldLivesTable.lifeId, { onDelete: "cascade", onUpdate: "cascade" }),
        extractionId: text("extraction_id").notNull(),
        securedItems: text("secured_items", { mode: "json" }).notNull().$type<WorldCarriedItems>(),
        rewardPoints: integer("reward_points").notNull().default(0),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    },
    (table) => [
        index("world_settlements_player_created_idx").on(table.playerId, table.createdAt),
        uniqueIndex("world_settlements_player_extraction_uq").on(table.playerId, table.extractionId),
    ],
);

export type WorldSettlementsTableSelect = typeof worldSettlementsTable.$inferSelect;

export const marketListingsTable = sqliteTable(
    "market_listings",
    {
        listingId: text("listing_id").primaryKey(),
        sellerId: text("seller_id")
            .notNull()
            .references(() => usersTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
        itemInstanceId: text("item_instance_id")
            .notNull()
            .references(() => worldItemInstancesTable.instanceId, { onDelete: "cascade", onUpdate: "cascade" }),
        mode: text("mode").notNull(),
        status: text("status").notNull().default("active"),
        price: integer("price"),
        currentPrice: integer("current_price"),
        clientRequestId: text("client_request_id").notNull(),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
        expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    },
    (table) => [
        index("market_listings_status_expires_idx").on(table.status, table.expiresAt),
        index("market_listings_item_status_idx").on(table.itemInstanceId, table.status),
        index("market_listings_seller_status_idx").on(table.sellerId, table.status),
        uniqueIndex("market_listings_seller_request_uq").on(table.sellerId, table.clientRequestId),
        uniqueIndex("market_listings_item_active_uq").on(table.itemInstanceId).where(
            sql`${table.status} = 'active'`,
        ),
    ],
);

export type MarketListingsTableSelect = typeof marketListingsTable.$inferSelect;

export const marketIntentsTable = sqliteTable(
    "market_intents",
    {
        intentId: text("intent_id").primaryKey(),
        listingId: text("listing_id")
            .notNull()
            .references(() => marketListingsTable.listingId, { onDelete: "cascade", onUpdate: "cascade" }),
        buyerId: text("buyer_id")
            .notNull()
            .references(() => usersTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
        type: text("type").notNull(),
        status: text("status").notNull().default("active"),
        amount: integer("amount").notNull(),
        clientRequestId: text("client_request_id").notNull(),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
        expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    },
    (table) => [
        index("market_intents_listing_status_idx").on(table.listingId, table.status),
        index("market_intents_buyer_status_idx").on(table.buyerId, table.status),
        uniqueIndex("market_intents_buyer_request_uq").on(table.buyerId, table.clientRequestId),
    ],
);

export type MarketIntentsTableSelect = typeof marketIntentsTable.$inferSelect;

export const marketWalletHoldsTable = sqliteTable(
    "market_wallet_holds",
    {
        holdId: text("hold_id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => usersTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
        listingId: text("listing_id")
            .notNull()
            .references(() => marketListingsTable.listingId, { onDelete: "cascade", onUpdate: "cascade" }),
        intentId: text("intent_id").references(() => marketIntentsTable.intentId, {
            onDelete: "set null",
            onUpdate: "cascade",
        }),
        amount: integer("amount").notNull(),
        status: text("status").notNull().default("active"),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    },
    (table) => [
        index("market_wallet_holds_user_status_idx").on(table.userId, table.status),
        index("market_wallet_holds_listing_status_idx").on(table.listingId, table.status),
        index("market_wallet_holds_intent_idx").on(table.intentId),
    ],
);

export type MarketWalletHoldsTableSelect = typeof marketWalletHoldsTable.$inferSelect;

export const marketTradesTable = sqliteTable(
    "market_trades",
    {
        tradeId: text("trade_id").primaryKey(),
        listingId: text("listing_id")
            .notNull()
            .references(() => marketListingsTable.listingId, { onDelete: "cascade", onUpdate: "cascade" }),
        itemInstanceId: text("item_instance_id")
            .notNull()
            .references(() => worldItemInstancesTable.instanceId, { onDelete: "cascade", onUpdate: "cascade" }),
        buyerId: text("buyer_id")
            .notNull()
            .references(() => usersTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
        sellerId: text("seller_id")
            .notNull()
            .references(() => usersTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
        price: integer("price").notNull(),
        fee: integer("fee").notNull(),
        sellerProceeds: integer("seller_proceeds").notNull(),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    },
    (table) => [
        index("market_trades_buyer_created_idx").on(table.buyerId, table.createdAt),
        index("market_trades_seller_created_idx").on(table.sellerId, table.createdAt),
        index("market_trades_listing_idx").on(table.listingId),
    ],
);

export type MarketTradesTableSelect = typeof marketTradesTable.$inferSelect;

export const userQuestTable = sqliteTable(
    "user_quest",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        userId: text("user_id")
            .notNull()
            .references(() => usersTable.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        idx: integer("idx").notNull(),
        questType: text("quest_type").notNull(),
        progress: integer("progress").notNull().default(0),
        target: integer("target").notNull(),
        complete: integer("complete", { mode: "boolean" }).notNull().default(false),
        rerolled: integer("rerolled", { mode: "boolean" }).notNull().default(false),
        timeAcquired: integer("time_acquired").notNull(),
        nextRefreshAt: integer("next_refresh_at").notNull(),
    },
    (table) => [uniqueIndex("user_quest_user_idx").on(table.userId, table.idx)],
);

export type UserQuestTableSelect = typeof userQuestTable.$inferSelect;

export const matchDataTable = sqliteTable(
    "match_data",
    {
        userId: text("user_id").default(""),
        userBanned: integer("user_banned", { mode: "boolean" }).default(false),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
        region: text("region").notNull(),
        mapId: integer("map_id").notNull(),
        gameId: text("game_id").notNull(),
        mapSeed: integer("map_seed").notNull(),
        username: text("username").notNull(),
        playerId: integer("player_id").notNull(),
        teamMode: integer("team_mode").$type<TeamMode>().notNull(),
        teamCount: integer("team_count").notNull(),
        teamTotal: integer("team_total").notNull(),
        teamId: integer("team_id").notNull(),
        timeAlive: integer("time_alive").notNull(),
        rank: integer("rank").notNull(),
        died: integer("died", { mode: "boolean" }).notNull(),
        kills: integer("kills").notNull(),
        teamKills: integer("team_kills").notNull().default(0),
        damageDealt: integer("damage_dealt").notNull(),
        damageTaken: integer("damage_taken").notNull(),
        killerId: integer("killer_id").notNull(),
        killedIds: text("killed_ids", { mode: "json" }).notNull().$type<number[]>(),
        role: text("role").notNull().default(""),
    },
    (table) => [
        index("idx_match_data_user_stats").on(
            table.userId,
            table.teamMode,
            table.rank,
            table.kills,
            table.damageDealt,
            table.timeAlive,
        ),
        index("idx_game_id").on(table.gameId),
        index("idx_user_id").on(table.userId),
        index("idx_match_data_team_query").on(
            table.teamMode,
            table.mapId,
            table.createdAt,
            table.gameId,
            table.teamId,
            table.region,
            table.kills,
        ),
    ],
);

export type MatchDataTable = typeof matchDataTable.$inferInsert;

//
// LOGS
//
export const ipLogsTable = sqliteTable(
    "ip_logs",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
        region: text("region").notNull(),
        gameId: text("game_id").notNull(),
        mapId: integer("map_id").notNull(),
        username: text("username").notNull(),
        userId: text("user_id").default(""),
        encodedIp: text("encoded_ip").notNull(),
        teamMode: integer("team_mode").$type<TeamMode>().notNull().default(TeamMode.Solo),
        ip: text("ip").notNull(),
        // also store the IP that was used in api/find_game...
        // since one could exploit that to never get banned
        // by requesting it with a different IP than the in-game one
        findGameIp: text("find_game_ip").notNull(),
        findGameEncodedIp: text("find_game_encoded_ip").notNull(),
    },
    (table) => [index("name_created_at_idx").on(table.username, table.createdAt)],
);

export type IpLogsTable = typeof ipLogsTable.$inferSelect;

export const bannedIpsTable = sqliteTable("banned_ips", {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    expiresIn: integer("expires_in", { mode: "timestamp_ms" }).notNull(),
    encodedIp: text("encoded_ip").notNull().primaryKey(),
    permanent: integer("permanent", { mode: "boolean" }).notNull().default(false),
    reason: text("reason").notNull().default(""),
    bannedBy: text("banned_by").notNull().default("admin"),
});
