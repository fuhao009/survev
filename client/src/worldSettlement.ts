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

function durableItemRows(items: readonly ItemInstance[], stateOverride?: string): WorldResultItem[] {
    return items.map((item) => ({
        kind: "durable" as const,
        type: item.type,
        label: getWorldItemLabel(item.type),
        quantity: item.quantity,
        ...(item.durabilityMax > 0
            ? { durability: item.durability, durabilityMax: item.durabilityMax }
            : {}),
        state: stateOverride ?? item.state,
    }));
}

function stackRows(snapshot: WorldSnapshot["life"]["carriedItems"]["snapshot"]): WorldResultItem[] {
    return snapshot.stacks.map((stack) => ({
        kind: "stack" as const,
        type: stack.itemType,
        label: getWorldItemLabel(stack.itemType),
        quantity: stack.quantity,
    }));
}

function countItems(rows: readonly WorldResultItem[]): number {
    return rows.reduce((total, row) => total + row.quantity, 0);
}

export function buildExtractedWorldResult(
    settlement: Extract<WorldSettlementState, { status: "finalized" }>,
    before: WorldSnapshot,
    after: WorldSnapshot,
): WorldResultViewModel {
    const equipment = durableItemRows(settlement.securedInventory);
    const stacks = stackRows(settlement.securedItems.snapshot);
    const items = [...equipment, ...stacks];
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
        carriedCount: countItems(items),
        warehouseCount: after.inventory.filter((item) => item.state === "stash").length,
        items,
        extractionQuote,
    };
}

export function buildDeadWorldResult(snapshot: WorldSnapshot): WorldResultViewModel {
    const dropped = snapshot.inventory.filter((item) => item.state === "world" || item.state === "destroyed");
    const items = [
        ...durableItemRows(dropped),
        ...stackRows(snapshot.life.carriedItems.snapshot),
    ];
    return {
        outcome: "dead",
        title: "本局已死亡",
        summary: "本局没有撤离成功，携带装备已掉落，未获得积分。",
        rewardPoints: 0,
        walletBefore: snapshot.walletBalance,
        walletAfter: snapshot.walletBalance,
        carriedCount: countItems(items),
        warehouseCount: snapshot.inventory.filter((item) => item.state === "stash").length,
        items,
    };
}
