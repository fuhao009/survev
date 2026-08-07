import { Hono } from "hono";
import { z } from "zod";
import { type WorldActionResponse, type WorldEnterResponse } from "../../../../../shared/types/worldApi.ts";
import { getDebugRequestContext } from "../../apiHelpers.ts";
import { server } from "../../apiServer.ts";
import {
    authMiddleware,
    databaseEnabledMiddleware,
    rateLimitMiddleware,
    validateParams,
} from "../../auth/middleware.ts";
import type { Context } from "../../index.ts";
import { WorldActionError, worldService } from "../../world/worldService.ts";

const zEnter = z.object({
    newLife: z.boolean().optional(),
});
const zAction = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("move"),
        x: z.number().finite(),
        y: z.number().finite(),
        expectedRevision: z.number().int().positive().optional(),
    }),
    z.object({
        type: z.literal("fire"),
        instanceId: z.string().min(1),
        expectedRevision: z.number().int().positive().optional(),
    }),
    z.object({
        type: z.literal("damage"),
        amount: z.number().int().positive().max(100),
        cause: z.enum(["player", "safe_zone", "fire", "hazard"]).optional(),
        expectedRevision: z.number().int().positive().optional(),
    }),
    z.object({ type: z.literal("extract"), expectedRevision: z.number().int().positive().optional() }),
    z.object({
        type: z.literal("repair"),
        instanceId: z.string().min(1),
        expectedRevision: z.number().int().positive().optional(),
    }),
]);

export const WorldRouter = new Hono<Context>()
    .use(databaseEnabledMiddleware)
    .use(rateLimitMiddleware(120, 60 * 1000))
    .use(authMiddleware)
    .post("/enter", validateParams(zEnter), async (c) => {
        const user = c.get("user")!;
        const { newLife } = c.req.valid("json");
        const debug = getDebugRequestContext(c);
        server.logger.debug("/api/world/enter request", {
            debug,
            userId: user.id,
            newLife: newLife ?? false,
        });
        const snapshot = await worldService.enter(user.id, user.loadout, newLife ?? false);
        server.logger.debug("/api/world/enter response", {
            debug,
            userId: user.id,
            lifeId: snapshot.life.lifeId,
            lifeStatus: snapshot.life.status,
            health: snapshot.life.status === "alive" ? snapshot.life.health : undefined,
            boost: snapshot.life.status === "alive" ? snapshot.life.boost : undefined,
            position: snapshot.life.status === "alive" ? snapshot.life.position : undefined,
            canExtract: snapshot.canExtract,
            extractionZone: snapshot.extractionZone,
            extractionQuote: snapshot.extractionQuote,
            inventoryCount: snapshot.inventory.length,
            walletBalance: snapshot.walletBalance,
            terrainMovement: snapshot.terrainMovement,
            weather: snapshot.weather.type,
            lightning: snapshot.lightning,
            worldRevision: snapshot.shard.worldRevision,
            onlinePlayers: snapshot.onlinePlayers,
        });
        return c.json<WorldEnterResponse>({ success: true, snapshot }, 200);
    })
    .post("/action", validateParams(zAction), async (c) => {
        const user = c.get("user")!;
        const debug = getDebugRequestContext(c);
        try {
            const action = c.req.valid("json");
            server.logger.debug("/api/world/action request", {
                debug,
                userId: user.id,
                type: action.type,
                expectedRevision: action.expectedRevision,
            });
            if (action.type === "damage" && process.env.NODE_ENV === "production") {
                return c.json({ success: false, error: "server_authoritative_damage" }, 403);
            }
            const response = await worldService.action(user.id, action);
            server.logger.debug("/api/world/action response", {
                debug,
                userId: user.id,
                type: action.type,
                lifeId: response.snapshot.life.lifeId,
                snapshotRevision: response.snapshot.life.revision,
                lifeStatus: response.snapshot.life.status,
                health: response.snapshot.life.status === "alive" ? response.snapshot.life.health : undefined,
                position: response.snapshot.life.status === "alive" ? response.snapshot.life.position : undefined,
                canExtract: response.snapshot.canExtract,
                extractionZone: response.snapshot.extractionZone,
                extractionQuote: response.snapshot.extractionQuote,
                inventoryCount: response.snapshot.inventory.length,
                walletBalance: response.snapshot.walletBalance,
                terrainMovement: response.snapshot.terrainMovement,
                settlement: response.settlement?.status,
            });
            return c.json<WorldActionResponse>(response, 200);
        } catch (err) {
            if (err instanceof WorldActionError) {
                server.logger.warn("/api/world/action rejected", {
                    debug,
                    userId: user.id,
                    code: err.code,
                });
                return c.json({ success: false, error: err.code }, 409);
            }
            throw err;
        }
    });
