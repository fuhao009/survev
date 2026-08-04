import { describe, expect, test } from "vitest";
import {
    getInitialItemDurability,
    getItemDurabilityKind,
    getRepairCost,
    isDamageWearItemType,
    isDurabilityTrackedItemType,
    isOneTimeItemType,
    isWeaponWearItemType,
    repairItem,
    wearItem,
} from "../../shared/types/itemDurability.ts";

function item(type: string, durability = 1000, state = "carried") {
    return { type, durability, durabilityMax: 1000, state };
}

describe("authoritative world item durability", () => {
    test("classifies persistent gear and excludes one-time loot", () => {
        for (
            const type of [
                "ak47",
                "fists",
                "outfitBase",
                "backpack01",
                "helmet01",
                "chest01",
                "1xscope",
                "crosshair_default",
            ]
        ) {
            expect(getItemDurabilityKind(type)).toBe("durable");
            expect(isDurabilityTrackedItemType(type)).toBe(true);
            expect(getInitialItemDurability(type)).toEqual({ durability: 1000, durabilityMax: 1000 });
        }
        for (const type of ["bandage", "soda", "frag", "9mm"]) {
            expect(getItemDurabilityKind(type)).toBe("one_time");
            expect(isOneTimeItemType(type)).toBe(true);
            expect(getInitialItemDurability(type)).toEqual({ durability: 0, durabilityMax: 0 });
        }
    });

    test("wears a weapon on use and rejects destroyed weapons", () => {
        expect(isWeaponWearItemType("ak47")).toBe(true);
        expect(wearItem(item("ak47", 2))).toEqual({ changed: true, durability: 1, state: "carried" });

        const destroyed = wearItem(item("ak47", 1));
        expect(destroyed).toEqual({ changed: true, durability: 0, state: "destroyed" });
        expect(wearItem({ ...item("ak47", 0, "destroyed") })).toEqual({
            changed: false,
            durability: 0,
            state: "destroyed",
        });
    });

    test("wears non-weapon equipment when damage is received", () => {
        expect(isDamageWearItemType("helmet01")).toBe(true);
        expect(isDamageWearItemType("chest01")).toBe(true);
        expect(wearItem(item("helmet01", 4))).toMatchObject({ durability: 3, state: "carried", changed: true });
        expect(wearItem(item("chest01", 4))).toMatchObject({ durability: 3, state: "carried", changed: true });
        expect(wearItem(item("outfitBase", 4))).toMatchObject({ durability: 3, state: "carried", changed: true });
    });

    test("does not apply durability wear to one-time items", () => {
        expect(wearItem(item("bandage", 0))).toEqual({ changed: false, durability: 0, state: "carried" });
        expect(wearItem(item("frag", 0))).toEqual({ changed: false, durability: 0, state: "carried" });
    });

    test("repairs a destroyed durable item and makes repeated repair a no-op", () => {
        const destroyed = item("helmet01", 0, "destroyed");
        expect(getRepairCost(destroyed)).toBe(100);

        const repaired = repairItem(destroyed);
        expect(repaired).toEqual({ changed: true, durability: 1000, state: "carried" });
        expect(getRepairCost({ ...destroyed, ...repaired })).toBe(0);
        expect(repairItem({ ...destroyed, ...repaired })).toEqual({
            changed: false,
            durability: 1000,
            state: "carried",
        });
    });

    test("does not charge or repair one-time items", () => {
        const bandage = item("bandage", 0);
        expect(getRepairCost(bandage)).toBeNull();
        expect(repairItem(bandage)).toEqual({ changed: false, durability: 0, state: "carried" });
    });
});
