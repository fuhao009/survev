import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

process.env.SURVEV_DB_DRIVER = "sqlite";
process.env.SURVEV_DATABASE_PATH = join(
    tmpdir(),
    `survev-world-entry-${process.pid}-${Date.now()}-${randomUUID()}.sqlite`,
);

const { db } = await import("../../server/src/api/db/index.ts");
const {
    usersTable,
    worldItemInstancesTable,
    worldLivesTable,
    worldShardsTable,
} = await import("../../server/src/api/db/schema.sqlite.ts");
const { worldService } = await import("../../server/src/api/world/worldService.ts");
const { loadout } = await import("../../shared/utils/loadout.ts");

beforeEach(async () => {
    await db.delete(worldItemInstancesTable);
    await db.delete(worldLivesTable);
    await db.delete(worldShardsTable);
    await db.delete(usersTable);
});

describe("world service entry", () => {
    test("keeps warehouse gear out of a fresh world life", async () => {
        const userId = "entry-player";
        await db.insert(usersTable).values({
            id: userId,
            authId: `auth-${userId}`,
            slug: `slug-${userId}`,
        });
        await db.insert(worldItemInstancesTable).values({
            instanceId: "stash-ak",
            userId,
            type: "ak47",
            quantity: 1,
            durability: 999,
            durabilityMax: 1000,
            state: "stash",
        });

        const snapshot = await worldService.enter(userId, loadout.defaultLoadout(), true);

        const stashAk = (await db.select().from(worldItemInstancesTable))
            .find((item) => item.instanceId === "stash-ak");
        expect(stashAk).toMatchObject({
            state: "stash",
            lifeId: null,
        });

        const life = (await db.select().from(worldLivesTable)).find((life) => life.playerId === userId);
        if (!life) throw new Error("Expected a fresh world life to be created");
        expect(life.carriedItems).toMatchObject({
            state: "carried",
            snapshot: {
                ownerId: userId,
                stacks: [],
                weapons: [],
                equipment: {
                    outfit: "",
                    backpack: "",
                    helmet: "",
                    chest: "",
                    perks: [],
                },
            },
        });
        expect(snapshot.inventory).toContainEqual(expect.objectContaining({
            type: "ak47",
            state: "stash",
        }));
    });
});
