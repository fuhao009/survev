import { describe, expect, test, vi } from "vitest";

const dbMocks = vi.hoisted(() => {
    const selectWhere = vi.fn(async () => []);
    const selectFrom = vi.fn(() => ({
        where: selectWhere,
    }));
    const select = vi.fn(() => ({
        from: selectFrom,
    }));

    return {
        select,
        selectFrom,
        selectWhere,
    };
});

vi.mock("../../server/src/api/db/index.ts", () => ({
    db: {
        select: dbMocks.select,
    },
}));

const { buildMissingWorldStackItemRows, buildWorldCarriedItemsSnapshot, worldService } = await import(
    "../../server/src/api/world/worldService.ts"
);

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

    test("hydrates carried stacks from persisted warehouse quantities", () => {
        expect(
            buildWorldCarriedItemsSnapshot(
                [{
                    instanceId: "bandage-1",
                    userId: "player-1",
                    lifeId: null,
                    type: "bandage",
                    quantity: 3,
                    durability: 0,
                    durabilityMax: 0,
                    state: "stash",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }],
                "player-1",
                2,
            ).stacks,
        ).toEqual([{ itemType: "bandage", quantity: 3 }]);
    });

    test("creates stash rows for extracted stacks that were not yet persisted", () => {
        const rows = buildMissingWorldStackItemRows(
            "player-1",
            null,
            {
                kind: "carried_items_snapshot",
                ownerId: "player-1",
                revision: 2,
                stacks: [{ itemType: "bandage", quantity: 3 }],
                weapons: [],
                equipment: {
                    outfit: "",
                    backpack: "",
                    helmet: "",
                    chest: "",
                    perks: [],
                },
            },
            [],
            "stash",
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            userId: "player-1",
            lifeId: null,
            type: "bandage",
            quantity: 3,
            durability: 0,
            durabilityMax: 0,
            state: "stash",
        });
    });

    test("does not seed starter world items for a new life", async () => {
        dbMocks.select.mockClear();
        dbMocks.selectFrom.mockClear();
        dbMocks.selectWhere.mockClear();

        await expect((worldService as unknown as {
            ensureStarterItems(userId: string): Promise<unknown[]>;
        }).ensureStarterItems("player-1")).resolves.toEqual([]);
        expect(dbMocks.select).not.toHaveBeenCalled();
    });
});
