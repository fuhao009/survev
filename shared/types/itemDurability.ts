import { GameObjectDefs } from "../defs/register.ts";
import { ITEM_DURABILITY_MAX } from "./itemInstance.ts";

/**
 * These game-object types are consumed when used and therefore do not carry
 * persistent wear. Their quantity/consumption rules remain separate from
 * item-instance durability.
 */
export const ONE_TIME_GAME_OBJECT_TYPES = [
    "ammo",
    "heal",
    "boost",
    "throwable",
] as const;

/** Game-object types represented as persistent, repairable item instances. */
export const DURABILITY_GAME_OBJECT_TYPES = [
    "gun",
    "melee",
    "outfit",
    "backpack",
    "helmet",
    "chest",
    "scope",
    "crosshair",
    "emote",
    "perk",
    "heal_effect",
    "boost_effect",
] as const;

/** Equipment that loses wear when the player receives damage in the world. */
export const DAMAGE_WEAR_GAME_OBJECT_TYPES = [
    "outfit",
    "backpack",
    "helmet",
    "chest",
] as const;

export type ItemDurabilityKind = "durable" | "one_time" | "untracked";

export interface DurabilityItemState {
    type: string;
    durability: number;
    durabilityMax: number;
    state: string;
}

export interface ItemDurabilityTransition {
    changed: boolean;
    durability: number;
    state: string;
}

const oneTimeTypes = new Set<string>(ONE_TIME_GAME_OBJECT_TYPES);
const durabilityTypes = new Set<string>(DURABILITY_GAME_OBJECT_TYPES);
const damageWearTypes = new Set<string>(DAMAGE_WEAR_GAME_OBJECT_TYPES);

function getGameObjectType(itemType: string): string | undefined {
    return GameObjectDefs.typeToDefSafe(itemType)?.type;
}

/**
 * Unknown definitions are rejected instead of silently becoming durable. This
 * keeps invalid or non-inventory game objects out of the persistent item
 * ledger while making all known non-consumable inventory types repairable.
 */
export function getItemDurabilityKind(itemType: string): ItemDurabilityKind {
    const gameObjectType = getGameObjectType(itemType);
    if (!gameObjectType) return "untracked";
    if (oneTimeTypes.has(gameObjectType)) return "one_time";
    if (durabilityTypes.has(gameObjectType)) return "durable";
    return "untracked";
}

export function isOneTimeItemType(itemType: string): boolean {
    return getItemDurabilityKind(itemType) === "one_time";
}

export function isDurabilityTrackedItemType(itemType: string): boolean {
    return getItemDurabilityKind(itemType) === "durable";
}

export function isDamageWearItemType(itemType: string): boolean {
    const gameObjectType = getGameObjectType(itemType);
    return gameObjectType !== undefined && damageWearTypes.has(gameObjectType);
}

export function isWeaponWearItemType(itemType: string): boolean {
    const gameObjectType = getGameObjectType(itemType);
    return gameObjectType === "gun" || gameObjectType === "melee";
}

export function getInitialItemDurability(itemType: string) {
    return isDurabilityTrackedItemType(itemType)
        ? { durability: ITEM_DURABILITY_MAX, durabilityMax: ITEM_DURABILITY_MAX }
        : { durability: 0, durabilityMax: 0 };
}

export function wearItem(
    item: DurabilityItemState,
    amount = 1,
): ItemDurabilityTransition {
    if (
        amount <= 0
        || !isDurabilityTrackedItemType(item.type)
        || item.state === "destroyed"
        || item.durability <= 0
        || item.durabilityMax <= 0
    ) {
        return { changed: false, durability: item.durability, state: item.state };
    }

    const durability = Math.max(0, item.durability - Math.trunc(amount));
    return {
        changed: durability !== item.durability,
        durability,
        state: durability === 0 ? "destroyed" : item.state,
    };
}

export function getRepairCost(item: DurabilityItemState): number | null {
    if (!isDurabilityTrackedItemType(item.type)) return null;
    if (item.durability >= item.durabilityMax) return 0;
    return Math.max(1, Math.ceil((item.durabilityMax - item.durability) / 10));
}

export function repairItem(item: DurabilityItemState): ItemDurabilityTransition {
    const cost = getRepairCost(item);
    if (cost === null || cost === 0) {
        return { changed: false, durability: item.durability, state: item.state };
    }

    return {
        changed: true,
        durability: item.durabilityMax,
        state: item.state === "destroyed" ? "carried" : item.state,
    };
}
