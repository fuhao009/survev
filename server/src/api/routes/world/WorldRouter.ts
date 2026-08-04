import { Hono } from "hono";
import { z } from "zod";
import { type WorldActionResponse, type WorldEnterResponse } from "../../../../../shared/types/worldApi.ts";
import { authMiddleware, databaseEnabledMiddleware, rateLimitMiddleware, validateParams } from "../../auth/middleware.ts";
import type { Context } from "../../index.ts";
import { WorldActionError, worldService } from "../../world/worldService.ts";

const zEnter = z.object({});
const zAction = z.discriminatedUnion("type", [
    z.object({ type: z.literal("move"), x: z.number().finite(), y: z.number().finite(), expectedRevision: z.number().int().positive().optional() }),
    z.object({ type: z.literal("fire"), instanceId: z.string().min(1), expectedRevision: z.number().int().positive().optional() }),
    z.object({ type: z.literal("damage"), amount: z.number().int().positive().max(100), cause: z.enum(["player", "safe_zone", "fire", "hazard"]).optional(), expectedRevision: z.number().int().positive().optional() }),
    z.object({ type: z.literal("extract"), expectedRevision: z.number().int().positive().optional() }),
    z.object({ type: z.literal("repair"), instanceId: z.string().min(1), expectedRevision: z.number().int().positive().optional() }),
]);

export const WorldRouter = new Hono<Context>()
    .use(databaseEnabledMiddleware)
    .use(rateLimitMiddleware(120, 60 * 1000))
    .use(authMiddleware)
    .post("/enter", validateParams(zEnter), async (c) => {
        const user = c.get("user")!;
        const snapshot = await worldService.enter(user.id, user.loadout);
        return c.json<WorldEnterResponse>({ success: true, snapshot }, 200);
    })
    .post("/action", validateParams(zAction), async (c) => {
        const user = c.get("user")!;
        try {
            const action = c.req.valid("json");
            if (action.type === "damage" && process.env.NODE_ENV === "production") {
                return c.json({ success: false, error: "server_authoritative_damage" }, 403);
            }
            const response = await worldService.action(user.id, action);
            return c.json<WorldActionResponse>(response, 200);
        } catch (err) {
            if (err instanceof WorldActionError) {
                return c.json({ success: false, error: err.code }, 409);
            }
            throw err;
        }
    });
