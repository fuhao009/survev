import { type Context as HonoContext, Hono } from "hono";
import { z } from "zod";
import type {
    MarketListingsResponse,
    MarketMineResponse,
    MarketMutationResponse,
} from "../../../../../shared/types/market.ts";
import { server } from "../../apiServer.ts";
import {
    authMiddleware,
    databaseEnabledMiddleware,
    rateLimitMiddleware,
    validateParams,
} from "../../auth/middleware.ts";
import type { Context as ApiContext } from "../../index.ts";
import {
    type CreateMarketListingInput,
    type MarketListFilters,
    marketService,
    MarketServiceError,
} from "../../market/MarketService.ts";

const zCreateListing = z.object({
    itemInstanceId: z.string().min(1),
    mode: z.enum(["fixed_price", "auction", "offers"]),
    price: z.number().int().positive().optional().nullable(),
    clientRequestId: z.string().min(1),
});

const zBidOrOffer = z.object({
    amount: z.number().int().positive(),
    clientRequestId: z.string().min(1),
});

function parseOptionalNumber(value: string | null) {
    if (value === null || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFilters(c: HonoContext<ApiContext>): MarketListFilters {
    const params = new URL(c.req.url).searchParams;
    const mode = params.get("mode");
    const sort = params.get("sort");
    return {
        mode: mode === "fixed_price" || mode === "auction" || mode === "offers" ? mode : undefined,
        type: params.get("type") || params.get("itemType") || undefined,
        minPrice: parseOptionalNumber(params.get("minPrice")),
        maxPrice: parseOptionalNumber(params.get("maxPrice")),
        minDurability: parseOptionalNumber(params.get("minDurability")),
        maxDurability: parseOptionalNumber(params.get("maxDurability")),
        sort: sort === "price_asc" || sort === "price_desc" || sort === "durability_desc" || sort === "newest"
            ? sort
            : undefined,
        limit: parseOptionalNumber(params.get("limit")),
        offset: parseOptionalNumber(params.get("offset")),
    };
}

function mutationErrorResponse(error: unknown) {
    if (error instanceof MarketServiceError) {
        return { success: false as const, error: error.code };
    }
    throw error;
}

export const MarketRouter = new Hono<ApiContext>()
    .use(databaseEnabledMiddleware)
    .use(rateLimitMiddleware(80, 60 * 1000))
    .use(authMiddleware)
    .get("/listings", async (c) => {
        const listings = await marketService.listListings(parseFilters(c));
        return c.json<MarketListingsResponse>(listings, 200);
    })
    .get("/mine", async (c) => {
        const user = c.get("user")!;
        const mine = await marketService.getMine(user.id);
        return c.json<MarketMineResponse>(mine, 200);
    })
    .post("/listings", validateParams(zCreateListing), async (c) => {
        const user = c.get("user")!;
        try {
            const body = c.req.valid("json") as CreateMarketListingInput;
            const listing = await marketService.createListing(user.id, body);
            return c.json<MarketMutationResponse>({ success: true, listing }, 200);
        } catch (error) {
            server.logger.warn("/api/market/listings rejected", { error });
            return c.json<MarketMutationResponse>(mutationErrorResponse(error), 409);
        }
    })
    .post("/listings/:listingId/buy", async (c) => {
        const user = c.get("user")!;
        try {
            const trade = await marketService.buyListing(user.id, c.req.param("listingId"));
            return c.json<MarketMutationResponse>({ success: true, trade }, 200);
        } catch (error) {
            server.logger.warn("/api/market/listings/buy rejected", { error });
            return c.json<MarketMutationResponse>(mutationErrorResponse(error), 409);
        }
    })
    .post("/listings/:listingId/bid", validateParams(zBidOrOffer), async (c) => {
        const user = c.get("user")!;
        try {
            const body = c.req.valid("json");
            const intent = await marketService.bid(
                user.id,
                c.req.param("listingId"),
                body.amount,
                body.clientRequestId,
            );
            return c.json<MarketMutationResponse>({ success: true, intent }, 200);
        } catch (error) {
            server.logger.warn("/api/market/listings/bid rejected", { error });
            return c.json<MarketMutationResponse>(mutationErrorResponse(error), 409);
        }
    })
    .post("/listings/:listingId/offers", validateParams(zBidOrOffer), async (c) => {
        const user = c.get("user")!;
        try {
            const body = c.req.valid("json");
            const intent = await marketService.offer(
                user.id,
                c.req.param("listingId"),
                body.amount,
                body.clientRequestId,
            );
            return c.json<MarketMutationResponse>({ success: true, intent }, 200);
        } catch (error) {
            server.logger.warn("/api/market/listings/offers rejected", { error });
            return c.json<MarketMutationResponse>(mutationErrorResponse(error), 409);
        }
    })
    .post("/listings/:listingId/cancel", async (c) => {
        const user = c.get("user")!;
        try {
            const listing = await marketService.cancelListing(user.id, c.req.param("listingId"));
            return c.json<MarketMutationResponse>({ success: true, listing }, 200);
        } catch (error) {
            server.logger.warn("/api/market/listings/cancel rejected", { error });
            return c.json<MarketMutationResponse>(mutationErrorResponse(error), 409);
        }
    })
    .post("/offers/:intentId/accept", async (c) => {
        const user = c.get("user")!;
        try {
            const trade = await marketService.acceptOffer(user.id, c.req.param("intentId"));
            return c.json<MarketMutationResponse>({ success: true, trade }, 200);
        } catch (error) {
            server.logger.warn("/api/market/offers/accept rejected", { error });
            return c.json<MarketMutationResponse>(mutationErrorResponse(error), 409);
        }
    })
    .post("/offers/:intentId/reject", async (c) => {
        const user = c.get("user")!;
        try {
            const intent = await marketService.rejectOffer(user.id, c.req.param("intentId"));
            return c.json<MarketMutationResponse>({ success: true, intent }, 200);
        } catch (error) {
            server.logger.warn("/api/market/offers/reject rejected", { error });
            return c.json<MarketMutationResponse>(mutationErrorResponse(error), 409);
        }
    })
    .post("/offers/:intentId/cancel", async (c) => {
        const user = c.get("user")!;
        try {
            const intent = await marketService.cancelOffer(user.id, c.req.param("intentId"));
            return c.json<MarketMutationResponse>({ success: true, intent }, 200);
        } catch (error) {
            server.logger.warn("/api/market/offers/cancel rejected", { error });
            return c.json<MarketMutationResponse>(mutationErrorResponse(error), 409);
        }
    });

export type MarketRouterApp = typeof MarketRouter;
