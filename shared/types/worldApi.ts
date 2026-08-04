import type { ItemInstance } from "./itemInstance.ts";
import type { WorldCircle, WorldLife, WorldSettlementState, WorldShard } from "./world.ts";

export interface WorldSnapshot {
    shard: WorldShard;
    life: WorldLife;
    inventory: ItemInstance[];
    walletBalance: number;
    onlinePlayers: number;
    extractionZone: WorldCircle;
    canExtract: boolean;
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
