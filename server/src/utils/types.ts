import { z } from "zod";
import type { MapDefKey } from "../../../shared/defs/mapDefs.ts";
import { TeamMode } from "../../../shared/gameConfig.ts";
import { type FindGamePrivateError, loadoutSchema } from "../../../shared/types/api.ts";
import type { WorldPosition } from "../../../shared/types/world.ts";
import type { MatchDataTable } from "../api/db/schema.ts";

const zWorldPosition = z.object({
    position: z.object({
        x: z.number(),
        y: z.number(),
    }),
    layer: z.number().int(),
}) satisfies z.ZodType<WorldPosition>;

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
