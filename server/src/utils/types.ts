import { z } from "zod";
import type { MapDefKey } from "../../../shared/defs/mapDefs.ts";
import { TeamMode } from "../../../shared/gameConfig.ts";
import { type FindGamePrivateError, loadoutSchema } from "../../../shared/types/api.ts";
import type { WorldCarriedItemsSnapshot, WorldPosition } from "../../../shared/types/world.ts";
import type { MatchDataTable } from "../api/db/schema.ts";

const zWorldPosition = z.object({
    position: z.object({
        x: z.number(),
        y: z.number(),
    }),
    layer: z.number().int(),
}) satisfies z.ZodType<WorldPosition>;

const zWorldCarriedItemsSnapshot = z.object({
    kind: z.literal("carried_items_snapshot"),
    ownerId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    stacks: z.array(z.object({
        itemType: z.string().min(1),
        quantity: z.number().int().nonnegative(),
    })),
    weapons: z.array(z.object({
        itemType: z.string().min(1),
        slot: z.enum(["primary", "secondary", "melee", "throwable"]),
        loadedAmmo: z.number().int().nonnegative(),
    })),
    equipment: z.object({
        outfit: z.string(),
        backpack: z.string(),
        helmet: z.string(),
        chest: z.string(),
        perks: z.array(z.string()),
    }),
}) satisfies z.ZodType<WorldCarriedItemsSnapshot>;

export const zUpdateRegionBody = z.object({
    regionId: z.string(),
    data: z.object({
        playerCount: z.number(),
    }),
});
export type UpdateRegionBody = z.infer<typeof zUpdateRegionBody>;

export const zSetGameModeBody = z.object({
    index: z.number(),
    team_mode: z.enum(TeamMode).optional(),
    map_name: z.string().optional(),
    enabled: z.boolean().optional(),
});

export const zSetClientThemeBody = z.object({
    theme: z.string(),
});

export interface SaveGameBody {
    matchData: (MatchDataTable & { ip: string; findGameIp: string })[];
}

export interface ServerGameConfig {
    readonly mapName: MapDefKey;
    readonly teamMode: TeamMode;
    readonly world: boolean;
}

export const zFindGamePrivateBody = z.object({
    region: z.string(),
    version: z.number(),
    autoFill: z.boolean(),
    mapName: z.string(),
    teamMode: z.number(),
    world: z.boolean().optional(),
    playerData: z.array(
        z.object({
            token: z.string(),
            userId: z.string().nullable(),
            ip: z.string(),
            loadout: loadoutSchema.optional(),
            quests: z.array(z.string()).optional(),
            worldPosition: zWorldPosition.optional(),
            worldHealth: z.number().finite().min(0).max(100).optional(),
            worldBoost: z.number().finite().min(0).max(100).optional(),
            worldItems: zWorldCarriedItemsSnapshot.optional(),
        }),
    ),
});

export type FindGamePrivateBody = z.infer<typeof zFindGamePrivateBody>;

export type FindGamePrivateRes =
    | {
        gameId: string;
        urls: string[];
    }
    | { error: FindGamePrivateError };
