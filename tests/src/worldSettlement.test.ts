import { describe, expect, test } from "vitest";
import {
    buildDeadWorldResult,
    buildExtractedWorldResult,
    getWorldItemStateLabel,
    WORLD_RESULT_RETURN_HASH,
} from "../../client/src/worldSettlement.ts";
import type { ItemInstance } from "../../shared/types/itemInstance.ts";
import type { WorldSettlementState } from "../../shared/types/world.ts";
import type { WorldSnapshot } from "../../shared/types/worldApi.ts";

const carriedSnapshot = {
    kind: "carried_items_snapshot" as const,
    ownerId: "player-1",
    revision: 4,
    stacks: [{ itemType: "bandage", quantity: 3 }],
    weapons: [{ itemType: "ak47", slot: "primary" as const, loadedAmmo: 0 }],
    equipment: {
        outfit: "outfitBase",
        backpack: "backpack01",
        helmet: "helmet01",
        chest: "chest01",
        perks: [],
    },
};

function item(
    type: string,
    state: ItemInstance["state"],
    durability: number,
    durabilityMax = 1000,
): ItemInstance {
    return {
        instanceId: `${type}-${state}`,
        type,
        quantity: 1,
        durability,
        durabilityMax,
        state,
        ownerId: "player-1",
    };
}

function snapshot(inventory: ItemInstance[], walletBalance: number): WorldSnapshot {
    return {
        inventory,
        walletBalance,
        life: {
            status: "dead",
            carriedItems: {
                state: "dropped_on_death",
                snapshot: carriedSnapshot,
                dropId: "drop-1",
                droppedAt: 1,
            },
        },
    } as unknown as WorldSnapshot;
}

const finalizedSettlement = {
    kind: "world_settlement" as const,
    authority: "server" as const,
    settlementId: "settlement-1",
    playerId: "player-1",
    shardId: "shard-1",
    lifeId: "life-1",
    extractionId: "extraction-1",
    sourceWorldRevision: 1,
    sourceLifeRevision: 4,
    status: "finalized" as const,
    finalizedAt: 2,
    receiptId: "receipt-1",
    securedItems: {
        state: "secured_on_extraction" as const,
        snapshot: carriedSnapshot,
        extractionId: "extraction-1",
        securedAt: 2,
    },
    securedInventory: [item("ak47", "stash", 742), item("helmet01", "stash", 1000)],
    rewards: [{
        rewardType: "points",
        quantity: 35,
        quote: {
            kind: "world_extraction_quote" as const,
            quoteId: "quote-1",
            extractionZoneId: "extraction-1",
            revision: 4,
            updatedAt: 2,
            baseItemPoints: 30,
            survivalPoints: 5,
            durabilityMultiplier: 1,
            competitionMultiplier: 1.2,
            scarcityMultiplier: 0.98,
            riskMultiplier: 1.05,
            totalPoints: 35,
            onlinePlayers: 12,
            recentExtractions: 3,
        },
    }],
} satisfies Extract<WorldSettlementState, { status: "finalized" }>;

describe("world settlement presentation", () => {
    test("renders extraction reward, wallet change, durability, and stacks", () => {
        const before = snapshot([item("ak47", "carried", 742), item("helmet01", "carried", 1000)], 46);
        const after = snapshot([item("ak47", "stash", 742), item("helmet01", "stash", 1000)], 81);
        const result = buildExtractedWorldResult(finalizedSettlement, before, after);

        expect(result.outcome).toBe("extracted");
        expect(result.title).toBe("撤离成功");
        expect(result.rewardPoints).toBe(35);
        expect(result.extractionQuote?.totalPoints).toBe(35);
        expect(result.walletBefore).toBe(46);
        expect(result.walletAfter).toBe(81);
        expect(result.carriedCount).toBe(5);
        expect(result.warehouseCount).toBe(2);
        expect(result.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: "AK-47", durability: 742, durabilityMax: 1000 }),
            expect.objectContaining({ kind: "stack", label: "bandage", quantity: 3 }),
        ]));
        expect(result.items.find((item) => item.kind === "stack")).not.toHaveProperty("durability");
    });

    test("keeps death semantics and shows dropped equipment without reward", () => {
        const deadSnapshot = snapshot([item("ak47", "world", 0), item("helmet01", "destroyed", 0)], 46);
        const result = buildDeadWorldResult(deadSnapshot);

        expect(result.outcome).toBe("dead");
        expect(result.title).toBe("本局已死亡");
        expect(result.rewardPoints).toBe(0);
        expect(result.walletBefore).toBe(46);
        expect(result.walletAfter).toBe(46);
        expect(result.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: "AK-47", state: "world", durability: 0 }),
            expect.objectContaining({ label: "头盔", state: "destroyed", durability: 0 }),
        ]));
    });

    test("maps item states to visible Chinese labels", () => {
        expect(getWorldItemStateLabel("stash")).toBe("已入库");
        expect(getWorldItemStateLabel("world")).toBe("已掉落");
        expect(getWorldItemStateLabel("destroyed")).toBe("已损坏");
        expect(WORLD_RESULT_RETURN_HASH).toBe("#user-center");
    });
});
