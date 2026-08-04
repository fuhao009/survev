import type { ItemInstance } from "./itemInstance.ts";
import type { WorldCircle, WorldLife, WorldSettlementState, WorldShard } from "./world.ts";
import type { WorldTerrain } from "./worldTerrain.ts";
import type { WorldWeather } from "./worldWeather.ts";

export interface WorldSnapshot {
    shard: WorldShard;
    life: WorldLife;
    inventory: ItemInstance[];
    walletBalance: number;
    onlinePlayers: number;
    extractionZone: WorldCircle;
    canExtract: boolean;
    terrain: WorldTerrain;
    weather: WorldWeather;
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
