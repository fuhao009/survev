import type { MapId } from "../gameConfig.ts";
import type { Vec2 } from "../utils/v2.ts";
import type { WorldWeather } from "./worldWeather.ts";

/** Unix time in milliseconds. Timestamps are written by the authoritative server. */
export type WorldTimestamp = number;

export interface WorldPosition {
    position: Vec2;
    /** Map layer, matching the layer used by game objects. */
    layer: number;
}

export interface WorldCircle {
    center: Vec2;
    /** Radius is expressed in world units. */
    radius: number;
}

/** Server-owned extraction area for the first persistent world shard. */
export const WORLD_EXTRACTION_ZONE = {
    center: { x: 2048, y: 2048 },
    radius: 320,
} as const satisfies WorldCircle;

//
// Persistent world shards
//

interface WorldShardBase {
    readonly kind: "world_shard";
    /** Open-world shards survive an individual player life and match. */
    readonly persistence: "persistent";
    shardId: string;
    worldId: string;
    mapId: MapId;
    /** Stable seed used to reproduce the persistent world layout. */
    seed: string;
    /** Monotonic world state revision, assigned by the server. */
    worldRevision: number;
    /** Revision of the last durable snapshot. */
    snapshotRevision: number;
    safeZone: WorldSafeZone;
    weather: WorldWeather;
    createdAt: WorldTimestamp;
}

/**
 * The shard lifecycle is intentionally discriminated. A closed or draining
 * shard must not accept new world mutations from a client.
 */
export type WorldShard =
    | (WorldShardBase & {
        status: "active";
        lastHeartbeatAt: WorldTimestamp;
    })
    | (WorldShardBase & {
        status: "draining";
        drainAt: WorldTimestamp;
        lastHeartbeatAt: WorldTimestamp;
    })
    | (WorldShardBase & {
        status: "closed";
        closedAt: WorldTimestamp;
        closeReason: "shutdown" | "error" | "replaced";
    });

//
// Safe zone
//

interface WorldSafeZoneBase {
    readonly kind: "safe_zone";
    zoneId: string;
    revision: number;
    /** The circle currently protecting players. */
    current: WorldCircle;
    /** Damage applied outside the current circle, in health per second. */
    outsideDamagePerSecond: number;
}

/**
 * Safe-zone state mirrors the server's current/target circle model. Clients
 * may interpolate it for display, but the server decides whether a position
 * is safe and whether damage or extraction is allowed.
 */
export type WorldSafeZone =
    | (WorldSafeZoneBase & {
        phase: "inactive";
        target: null;
    })
    | (WorldSafeZoneBase & {
        phase: "stable";
        target: null;
    })
    | (WorldSafeZoneBase & {
        phase: "shrinking";
        target: WorldCircle;
        progress: number;
        startedAt: WorldTimestamp;
        endsAt: WorldTimestamp;
    })
    | (WorldSafeZoneBase & {
        phase: "closed";
        target: null;
        closedAt: WorldTimestamp;
    });

/** Short name for consumers that do not need the World prefix. */
export type SafeZone = WorldSafeZone;

//
// Carried items
//

export interface WorldItemStack {
    itemType: string;
    quantity: number;
}

export type WorldWeaponSlot = "primary" | "secondary" | "melee" | "throwable";

export interface WorldCarriedWeapon {
    itemType: string;
    slot: WorldWeaponSlot;
    /** Loaded ammunition; reserve ammunition belongs in stacks. */
    loadedAmmo: number;
}

export interface WorldCarriedEquipment {
    outfit: string;
    backpack: string;
    helmet: string;
    chest: string;
    perks: readonly string[];
}

/** A server-validated inventory/equipment snapshot, not raw client input. */
export interface WorldCarriedItemsSnapshot {
    readonly kind: "carried_items_snapshot";
    ownerId: string;
    revision: number;
    stacks: readonly WorldItemStack[];
    weapons: readonly WorldCarriedWeapon[];
    equipment: WorldCarriedEquipment;
}

/**
 * Item ownership changes are explicit so death cannot accidentally preserve
 * items and extraction cannot accidentally settle a pre-death inventory.
 */
export type WorldCarriedItems =
    | {
        state: "carried";
        snapshot: WorldCarriedItemsSnapshot;
        capturedAt: WorldTimestamp;
    }
    | {
        state: "dropped_on_death";
        snapshot: WorldCarriedItemsSnapshot;
        dropId: string;
        droppedAt: WorldTimestamp;
    }
    | {
        state: "secured_on_extraction";
        snapshot: WorldCarriedItemsSnapshot;
        extractionId: string;
        securedAt: WorldTimestamp;
    }
    | {
        state: "lost_on_death";
        snapshot: WorldCarriedItemsSnapshot;
        lostAt: WorldTimestamp;
        reason: "shard_reset" | "no_drop_destination" | "server_policy";
    };

/** Short name for consumers that do not need the World prefix. */
export type CarriedItems = WorldCarriedItems;

type InWorldCarriedItems = Extract<WorldCarriedItems, { state: "carried" }>;
type PostDeathCarriedItems = Extract<
    WorldCarriedItems,
    { state: "dropped_on_death" | "lost_on_death" }
>;
type SecuredCarriedItems = Extract<WorldCarriedItems, { state: "secured_on_extraction" }>;

//
// Death and respawn
//

export type WorldDeathCause =
    | {
        kind: "player";
        playerId: string;
    }
    | {
        kind: "environment";
        source: "safe_zone" | "fire" | "fall" | "hazard" | "unknown";
    }
    | {
        kind: "disconnect_timeout";
    };

export interface WorldSpawnPoint extends WorldPosition {
    source: "checkpoint" | "safe_zone" | "server";
}

export type WorldRespawnState =
    | {
        status: "eligible";
        availableAt: WorldTimestamp;
        tokenId: string;
    }
    | {
        status: "scheduled";
        requestId: string;
        scheduledAt: WorldTimestamp;
        spawn: WorldSpawnPoint;
    }
    | {
        status: "unavailable";
        reason: "life_limit" | "no_checkpoint" | "shard_closed" | "settled" | "server_policy";
    };

interface WorldLifeBase {
    readonly kind: "world_life";
    lifeId: string;
    playerId: string;
    shardId: string;
    /** Monotonic snapshot revision; clients cannot advance it. */
    revision: number;
    startedAt: WorldTimestamp;
}

/**
 * A life is a server-owned lifecycle record. In particular, dead lives do
 * not retain an in-world carried state, and a respawn starts with a new
 * server-approved carried snapshot.
 */
export type WorldLife =
    | (WorldLifeBase & {
        status: "alive";
        position: WorldPosition;
        health: number;
        boost: number;
        carriedItems: InWorldCarriedItems;
    })
    | (WorldLifeBase & {
        status: "downed";
        position: WorldPosition;
        health: number;
        downedAt: WorldTimestamp;
        reviveUntil?: WorldTimestamp;
        carriedItems: InWorldCarriedItems;
    })
    | (WorldLifeBase & {
        status: "dead";
        diedAt: WorldTimestamp;
        cause: WorldDeathCause;
        killedByPlayerId?: string;
        respawn: WorldRespawnState;
        carriedItems: PostDeathCarriedItems;
    })
    | (WorldLifeBase & {
        status: "respawning";
        previousLifeId: string;
        respawn: Extract<WorldRespawnState, { status: "scheduled" }>;
        carriedItems: InWorldCarriedItems;
    })
    | (WorldLifeBase & {
        status: "extracted";
        extractedAt: WorldTimestamp;
        extractionId: string;
        settlementId: string;
        carriedItems: SecuredCarriedItems;
    });

//
// Settlement
//

export interface WorldSettlementReward {
    rewardType: string;
    quantity: number;
}

interface WorldSettlementBase {
    readonly kind: "world_settlement";
    /** Every settlement state is produced from server snapshots. */
    readonly authority: "server";
    settlementId: string;
    playerId: string;
    shardId: string;
    lifeId: string;
    extractionId: string;
    sourceWorldRevision: number;
    sourceLifeRevision: number;
}

/**
 * Settlement is separate from an extraction request. The server validates
 * the shard/life revisions and secured items before moving to finalized;
 * values supplied by a client cannot be used as a settlement result.
 */
export type WorldSettlementState =
    | (WorldSettlementBase & {
        status: "pending";
        createdAt: WorldTimestamp;
        securedItems: SecuredCarriedItems;
    })
    | (WorldSettlementBase & {
        status: "finalized";
        finalizedAt: WorldTimestamp;
        receiptId: string;
        securedItems: SecuredCarriedItems;
        rewards: readonly WorldSettlementReward[];
    })
    | (WorldSettlementBase & {
        status: "rejected";
        rejectedAt: WorldTimestamp;
        reason: "stale_snapshot" | "invalid_extraction" | "duplicate" | "shard_closed" | "server_error";
        retryable: boolean;
        securedItems: SecuredCarriedItems;
    });

/** Short name for consumers that do not need the World prefix. */
export type SettlementState = WorldSettlementState;

/**
 * Optional client-to-server claim shape. It is deliberately separate from
 * WorldSettlementState: all fields are untrusted claims and must be checked
 * against the authoritative WorldLife and WorldShard snapshots.
 */
export interface WorldSettlementClaim {
    readonly kind: "client_settlement_claim";
    clientRequestId: string;
    extractionId: string;
    claimedItems: WorldCarriedItemsSnapshot;
}
