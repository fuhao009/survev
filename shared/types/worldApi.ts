import type { ItemInstance } from "./itemInstance.ts";
import type {
    WorldExtractionQuote,
    WorldExtractionZone,
    WorldLife,
    WorldSettlementState,
    WorldShard,
} from "./world.ts";
import type { WorldLightning } from "./worldLightning.ts";
import type { WorldTerrain, WorldTerrainMovementModifier } from "./worldTerrain.ts";
import type { WorldWeather } from "./worldWeather.ts";

export interface WorldSnapshot {
    shard: WorldShard;
    life: WorldLife;
    inventory: ItemInstance[];
    walletBalance: number;
    onlinePlayers: number;
    extractionZone: WorldExtractionZone;
    extractionQuote: WorldExtractionQuote | null;
    canExtract: boolean;
    terrain: WorldTerrain;
    /** Server-derived at the life position; null when the life has no position. */
    terrainMovement: WorldTerrainMovementModifier | null;
    weather: WorldWeather;
    lightning: WorldLightning;
}

/** Server response for one persisted realtime world position. */
export interface WorldPositionTerrainMovement {
    userId: string;
    terrainMovement: WorldTerrainMovementModifier;
}

/** Batch response used by a game process position heartbeat. */
export interface WorldPositionSyncResponse {
    success: true;
    /** Kept for compatibility with callers that only count applied updates. */
    applied: number;
    terrainMovement: WorldPositionTerrainMovement[];
    terrain: WorldTerrain;
    weather: WorldWeather;
    worldSeed: string;
}

export interface WorldEnterResponse {
    success: true;
    snapshot: WorldSnapshot;
}

export interface WorldActionResponse {
    success: true;
    snapshot: WorldSnapshot;
    settlement?: WorldSettlementState;
}

export interface WorldErrorResponse {
    success: false;
    error: string;
}
