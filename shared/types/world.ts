import type { MapId } from "../gameConfig.ts";
import type { Vec2 } from "../utils/v2.ts";
import type { ItemInstance } from "./itemInstance.ts";
import type { WorldLightning } from "./worldLightning.ts";
import type { WorldTerrain } from "./worldTerrain.ts";
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

export interface WorldExtractionZone extends WorldCircle {
    readonly kind: "world_extraction_zone";
    /** Stable only for this extraction cycle; changes when the dynamic zone refreshes. */
    zoneId: string;
    /** Player-facing map label. */
    label: string;
    /** Monotonic cycle revision inside the shard. */
    revision: number;
    activeFrom: WorldTimestamp;
    activeUntil: WorldTimestamp;
}

export const WORLD_MAP_SIZE = 4096;
export const WORLD_EXTRACTION_CYCLE_DURATION_MS = 3 * 60 * 1000;
export const WORLD_EXTRACTION_ZONE_RADIUS = 280;
const WORLD_EXTRACTION_ZONE_MARGIN = 460;

/** Server-owned fallback extraction area for compatibility with older callers. */
export const WORLD_EXTRACTION_ZONE = {
    kind: "world_extraction_zone",
    zoneId: "extract-center-legacy",
    label: "撤离点",
    revision: 0,
    center: { x: WORLD_MAP_SIZE / 2, y: WORLD_MAP_SIZE / 2 },
    radius: 320,
    activeFrom: 0,
    activeUntil: WORLD_EXTRACTION_CYCLE_DURATION_MS,
} as const satisfies WorldExtractionZone;

function stableHash(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function normalizedHash(value: string): number {
    return stableHash(value) / 0xffffffff;
}

function boundedExtractionCoordinate(seed: string, cycle: number, axis: "x" | "y"): number {
    const span = WORLD_MAP_SIZE - WORLD_EXTRACTION_ZONE_MARGIN * 2;
    return Math.round(WORLD_EXTRACTION_ZONE_MARGIN + normalizedHash(`${seed}:extract:${cycle}:${axis}`) * span);
}

/** Derive a dynamic extraction point without mutable process state. */
export function getWorldExtractionZone(seed: string, createdAt: number, now = Date.now()): WorldExtractionZone {
    const elapsed = Math.max(0, now - createdAt);
    const cycle = Math.floor(elapsed / WORLD_EXTRACTION_CYCLE_DURATION_MS);
    const revision = cycle + 1;
    const activeFrom = createdAt + cycle * WORLD_EXTRACTION_CYCLE_DURATION_MS;
    const center = {
        x: boundedExtractionCoordinate(seed, cycle, "x"),
        y: boundedExtractionCoordinate(seed, cycle, "y"),
    };

    return {
        kind: "world_extraction_zone",
        zoneId: `extract-${revision}-${center.x}-${center.y}`,
        label: "撤离点",
        revision,
        center,
        radius: WORLD_EXTRACTION_ZONE_RADIUS,
        activeFrom,
        activeUntil: activeFrom + WORLD_EXTRACTION_CYCLE_DURATION_MS,
    };
}

export function worldPositionToGameMap(position: Vec2, mapWidth: number, mapHeight: number): Vec2 {
    return {
        x: Math.max(0, Math.min(mapWidth, (position.x / WORLD_MAP_SIZE) * mapWidth)),
        y: Math.max(0, Math.min(mapHeight, (position.y / WORLD_MAP_SIZE) * mapHeight)),
    };
}

export function gameMapPositionToWorld(position: Vec2, mapWidth: number, mapHeight: number): Vec2 {
    return {
        x: Math.max(0, Math.min(WORLD_MAP_SIZE, (position.x / mapWidth) * WORLD_MAP_SIZE)),
        y: Math.max(0, Math.min(WORLD_MAP_SIZE, (position.y / mapHeight) * WORLD_MAP_SIZE)),
    };
}

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
    terrain: WorldTerrain;
    weather: WorldWeather;
    lightning: WorldLightning;
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
    source?: string;
    quote?: WorldExtractionQuote;
}

export interface WorldExtractionQuoteInput {
    extractionZoneId: string;
    extractionRevision: number;
    updatedAt: WorldTimestamp;
    baseItemPoints: number;
    durabilityRatio: number;
    lifeRevision: number;
    elapsedMs: number;
    onlinePlayers: number;
    recentExtractions: number;
    weatherIntensity: number;
    terrainSpeedMultiplier: number;
    lightningEventCount: number;
}

export interface WorldExtractionQuote {
    readonly kind: "world_extraction_quote";
    quoteId: string;
    extractionZoneId: string;
    revision: number;
    updatedAt: WorldTimestamp;
    baseItemPoints: number;
    survivalPoints: number;
    durabilityMultiplier: number;
    competitionMultiplier: number;
    scarcityMultiplier: number;
    riskMultiplier: number;
    totalPoints: number;
    onlinePlayers: number;
    recentExtractions: number;
}

function clampUnit(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function roundMultiplier(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Dynamic extraction exchange quote. It intentionally depends on current
 * competitive state instead of a fixed per-run reward.
 */
export function getWorldExtractionQuote(input: WorldExtractionQuoteInput): WorldExtractionQuote {
    const onlinePlayers = Math.max(1, Math.trunc(input.onlinePlayers));
    const recentExtractions = Math.max(0, Math.trunc(input.recentExtractions));
    const baseItemPoints = Math.max(0, Math.round(input.baseItemPoints));
    const durabilityMultiplier = roundMultiplier(0.35 + clampUnit(input.durabilityRatio) * 0.65);
    const competitionMultiplier = roundMultiplier(
        1 + Math.min(0.72, Math.log2(onlinePlayers) * 0.14),
    );
    const scarcityMultiplier = roundMultiplier(
        Math.max(0.68, 1.22 - Math.min(10, recentExtractions) * 0.055),
    );
    const terrainPenalty = Math.max(0, 1 - Math.max(0.25, Math.min(1, input.terrainSpeedMultiplier)));
    const riskMultiplier = roundMultiplier(
        1
            + clampUnit(input.weatherIntensity) * 0.22
            + terrainPenalty * 0.18
            + Math.min(3, Math.max(0, input.lightningEventCount)) * 0.04,
    );
    const survivalPoints = Math.min(
        40,
        Math.max(0, Math.floor(input.elapsedMs / 60_000) * 2)
            + Math.max(0, Math.floor((input.lifeRevision - 1) / 3)),
    );
    const totalPoints = Math.max(
        1,
        Math.round(
            (baseItemPoints * durabilityMultiplier + survivalPoints) * competitionMultiplier * scarcityMultiplier
                * riskMultiplier,
        ),
    );

    return {
        kind: "world_extraction_quote",
        quoteId: `${input.extractionZoneId}:quote:${input.lifeRevision}:${totalPoints}`,
        extractionZoneId: input.extractionZoneId,
        revision: input.extractionRevision,
        updatedAt: input.updatedAt,
        baseItemPoints,
        survivalPoints,
        durabilityMultiplier,
        competitionMultiplier,
        scarcityMultiplier,
        riskMultiplier,
        totalPoints,
        onlinePlayers,
        recentExtractions,
    };
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
        /** Authoritative item-instance details after the secured items enter the stash. */
        securedInventory: readonly ItemInstance[];
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
