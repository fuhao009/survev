import { describe, expect, test, vi } from "vitest";

vi.mock("../../server/src/api/db/index.ts", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: async () => [],
            }),
        }),
    },
}));

const { buildWorldCarriedItemsSnapshot, worldService } = await import("../../server/src/api/world/worldService.ts");

describe("world service initial items", () => {
    test("starts a fresh life from an empty carried snapshot", () => {
        expect(buildWorldCarriedItemsSnapshot([], "player-1", 1)).toEqual({
            kind: "carried_items_snapshot",
            ownerId: "player-1",
            revision: 1,
            stacks: [],
            weapons: [],
            equipment: {
                outfit: "",
                backpack: "",
                helmet: "",
                chest: "",
                perks: [],
            },
        });
    });

    test("does not seed starter world items for a new life", async () => {
        await expect((worldService as typeof worldService & {
            ensureStarterItems(userId: string): Promise<unknown[]>;
        }).ensureStarterItems("player-1")).resolves.toEqual([]);
    });
});
