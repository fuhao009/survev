import { z } from "zod";

export const ITEM_DURABILITY_MIN = 0;
export const ITEM_DURABILITY_MAX = 1000;
export const ITEM_INSTANCE_QUANTITY = 1 as const;
export const ITEM_INSTANCE_QUANTITY_MIN = 1 as const;

export const ITEM_INSTANCE_STATES = [
    "stash",
    "equipped",
    "listed",
    "carried",
    "world",
    "destroyed",
] as const;

export type ItemDurability = z.infer<typeof zItemDurability>;
export type ItemInstanceState = typeof ITEM_INSTANCE_STATES[number];

export const zItemDurability = z
    .number()
    .int()
    .min(ITEM_DURABILITY_MIN)
    .max(ITEM_DURABILITY_MAX);

export const zItemInstanceState = z.enum(ITEM_INSTANCE_STATES);

/**
 * `durability`, `durabilityMax`, and `state` are the canonical names for the
 * former `currentDurability`, `maxDurability`, and `status` fields. Do not keep
 * both naming sets on an instance: the aliases would create two sources of truth.
 */
export const zItemInstance = z.strictObject({
    instanceId: z.string().min(1),
    type: z.string().min(1),
    quantity: z.number().int().min(ITEM_INSTANCE_QUANTITY_MIN),
    durability: zItemDurability,
    durabilityMax: zItemDurability,
    state: zItemInstanceState,
    ownerId: z.string().min(1).optional(),
}).refine(
    ({ durability, durabilityMax }) => durability <= durabilityMax,
    {
        message: "durability must not exceed durabilityMax",
        path: ["durability"],
    },
);

export type ItemInstance = z.infer<typeof zItemInstance>;

export function isValidItemDurability(value: unknown): value is ItemDurability {
    return typeof value === "number"
        && Number.isInteger(value)
        && value >= ITEM_DURABILITY_MIN
        && value <= ITEM_DURABILITY_MAX;
}

export function isItemInstance(value: unknown): value is ItemInstance {
    return zItemInstance.safeParse(value).success;
}

export function parseItemInstance(value: unknown): ItemInstance {
    return zItemInstance.parse(value);
}
