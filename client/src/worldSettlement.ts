import type { ItemInstance } from "../../shared/types/itemInstance.ts";
import type { WorldExtractionQuote, WorldSettlementState } from "../../shared/types/world.ts";
import type { WorldSnapshot } from "../../shared/types/worldApi.ts";

const ITEM_LABELS: Record<string, string> = {
    ak47: "AK-47",
    m9: "M9 手枪",
    fists: "拳套",
    outfitBase: "基础服装",
    backpack01: "背包",
    helmet01: "头盔",
    chest01: "防弹衣",
    crosshair_default: "默认准星",
};

const ITEM_STATE_LABELS: Record<string, string> = {
    stash: "已入库",
    listed: "已上架",
    world: "已掉落",
    destroyed: "已损坏",
    carried: "携带中",
    equipped: "已装备",
};

export const WORLD_RESULT_RETURN_HASH = "#user-center";

export interface WorldResultItem {
    kind: "durable" | "stack";
    type: string;
    label: string;
    quantity: number;
    durability?: number;
    durabilityMax?: number;
    state?: string;
}

export interface WorldResultViewModel {
    outcome: "extracted" | "dead";
    title: string;
    summary: string;
    rewardPoints: number;
    walletBefore: number;
    walletAfter: number;
    carriedCount: number;
    warehouseCount: number;
    items: readonly WorldResultItem[];
    extractionQuote?: WorldExtractionQuote;
}

export function getWorldItemLabel(type: string): string {
    return ITEM_LABELS[type] ?? type;
}

export function getWorldItemStateLabel(state: string | undefined): string {
    return state ? ITEM_STATE_LABELS[state] ?? state : "";
}

export function getWorldItemDurabilityRatio(
    item: Pick<ItemInstance, "durability" | "durabilityMax">,
): number {
    if (item.durabilityMax <= 0) return 0;
    return Math.max(0, Math.min(1, item.durability / item.durabilityMax));
}

export function formatWorldItemDurability(
    item: Pick<ItemInstance, "durability" | "durabilityMax">,
): string {
    return `${item.durability}/${item.durabilityMax}`;
}

function itemInstanceRows(items: readonly ItemInstance[], stateOverride?: string): WorldResultItem[] {
    return items.map((item) => ({
        kind: item.durabilityMax > 0 ? "durable" as const : "stack" as const,
        type: item.type,
        label: getWorldItemLabel(item.type),
        quantity: item.quantity,
        ...(item.durabilityMax > 0
            ? { durability: item.durability, durabilityMax: item.durabilityMax }
            : {}),
        state: stateOverride ?? item.state,
    }));
}

function stackRows(
    snapshot: WorldSnapshot["life"]["carriedItems"]["snapshot"],
    existingItems: readonly ItemInstance[] = [],
): WorldResultItem[] {
    const existingQuantities = existingItems.reduce((totals, item) => {
        if (item.durabilityMax > 0) return totals;
        totals.set(item.type, (totals.get(item.type) ?? 0) + item.quantity);
        return totals;
    }, new Map<string, number>());

    return snapshot.stacks.flatMap((stack) => {
        const existingQuantity = existingQuantities.get(stack.itemType) ?? 0;
        existingQuantities.set(stack.itemType, Math.max(0, existingQuantity - stack.quantity));
        const missingQuantity = Math.max(0, stack.quantity - existingQuantity);
        if (missingQuantity === 0) return [];
        return [{
            kind: "stack" as const,
            type: stack.itemType,
            label: getWorldItemLabel(stack.itemType),
            quantity: missingQuantity,
        }];
    });
}

function countInventoryItems(items: readonly ItemInstance[], state?: ItemInstance["state"]): number {
    return items.reduce((total, item) => {
        if (state !== undefined && item.state !== state) return total;
        return total + item.quantity;
    }, 0);
}

function countItems(rows: readonly WorldResultItem[]): number {
    return rows.reduce((total, row) => total + row.quantity, 0);
}

export function buildExtractedWorldResult(
    settlement: Extract<WorldSettlementState, { status: "finalized" }>,
    before: WorldSnapshot,
    after: WorldSnapshot,
): WorldResultViewModel {
    const securedRows = [
        ...itemInstanceRows(settlement.securedInventory),
        ...stackRows(settlement.securedItems.snapshot, settlement.securedInventory),
    ];
    const rewardPoints = settlement.rewards
        .filter((reward) => reward.rewardType === "points")
        .reduce((total, reward) => total + reward.quantity, 0);
    const extractionQuote = settlement.rewards.find((reward) => reward.rewardType === "points")?.quote
        ?? before.extractionQuote
        ?? undefined;
    return {
        outcome: "extracted",
        title: "撤离成功",
        summary: "装备已安全入库，积分已经结算。",
        rewardPoints,
        walletBefore: before.walletBalance,
        walletAfter: after.walletBalance,
        carriedCount: countItems(securedRows),
        warehouseCount: countInventoryItems(after.inventory, "stash"),
        items: [],
        extractionQuote,
    };
}

export function buildDeadWorldResult(snapshot: WorldSnapshot): WorldResultViewModel {
    const dropped = snapshot.inventory.filter((item) => item.state === "world" || item.state === "destroyed");
    const items = [
        ...itemInstanceRows(dropped),
        ...stackRows(snapshot.life.carriedItems.snapshot, dropped),
    ];
    return {
        outcome: "dead",
        title: "本局已死亡",
        summary: "本局没有撤离成功，携带装备已掉落，未获得积分。",
        rewardPoints: 0,
        walletBefore: snapshot.walletBalance,
        walletAfter: snapshot.walletBalance,
        carriedCount: countItems(items),
        warehouseCount: countInventoryItems(snapshot.inventory, "stash"),
        items,
    };
}
