import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseItemInstance } from "../../../../shared/types/itemInstance.ts";
import type { ItemInstance } from "../../../../shared/types/itemInstance.ts";
import {
    MARKET_AUCTION_DURATION_MS,
    MARKET_FEE_RATE_BASIS_POINTS,
    MARKET_FIXED_PRICE_DURATION_MS,
    MARKET_OFFER_DURATION_MS,
} from "../../../../shared/types/market.ts";
import type {
    MarketHoldStatus,
    MarketHoldView,
    MarketIntentStatus,
    MarketIntentView,
    MarketListingMode,
    MarketListingsResponse,
    MarketListingStatus,
    MarketListingView,
    MarketMineResponse,
    MarketTradeView,
} from "../../../../shared/types/market.ts";
import { db } from "../db/index.ts";
import {
    marketIntentsTable,
    marketListingsTable,
    marketTradesTable,
    marketWalletHoldsTable,
    usersTable,
    walletTransactionsTable,
    worldItemInstancesTable,
} from "../db/schema.sqlite.ts";

type MarketDb = typeof db;
type ListingRow = typeof marketListingsTable.$inferSelect;
type IntentRow = typeof marketIntentsTable.$inferSelect;
type HoldRow = typeof marketWalletHoldsTable.$inferSelect;
type TradeRow = typeof marketTradesTable.$inferSelect;
type ItemRow = typeof worldItemInstancesTable.$inferSelect;

interface JoinedListingRow extends ListingRow {
    item: ItemRow;
}

export interface CreateMarketListingInput {
    itemInstanceId: string;
    mode: MarketListingMode;
    price?: number | null;
    clientRequestId: string;
}

export interface MarketListFilters {
    mode?: MarketListingMode;
    type?: string;
    minPrice?: number;
    maxPrice?: number;
    minDurability?: number;
    maxDurability?: number;
    sort?: "newest" | "price_asc" | "price_desc" | "durability_desc";
    limit?: number;
    offset?: number;
}

const ACTIVE_LISTING_STATUS: MarketListingStatus = "active";
const ACTIVE_INTENT_STATUS: MarketIntentStatus = "active";
const ACTIVE_HOLD_STATUS: MarketHoldStatus = "active";
const MAX_LISTING_LIMIT = 100;

function withForUpdate<T>(query: T): T {
    return query;
}

function positiveInt(value: number, field: string) {
    if (!Number.isInteger(value) || value <= 0) throw new MarketServiceError(`${field}_invalid`);
    return value;
}

function feeFor(price: number) {
    return Math.floor((price * MARKET_FEE_RATE_BASIS_POINTS) / 10_000);
}

function itemToView(item: ItemRow): ItemInstance {
    return parseItemInstance({
        instanceId: item.instanceId,
        type: item.type,
        quantity: Math.max(1, Math.trunc(item.quantity)),
        durability: item.durability,
        durabilityMax: item.durabilityMax,
        state: item.state,
        ownerId: item.userId,
    });
}

function listingToView(row: JoinedListingRow): MarketListingView {
    return {
        listingId: row.listingId,
        sellerId: row.sellerId,
        item: itemToView(row.item),
        mode: row.mode as MarketListingMode,
        status: row.status as MarketListingStatus,
        price: row.price,
        currentPrice: row.currentPrice,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
    };
}

function intentToView(row: IntentRow): MarketIntentView {
    return {
        intentId: row.intentId,
        listingId: row.listingId,
        buyerId: row.buyerId,
        type: row.type as MarketIntentView["type"],
        status: row.status as MarketIntentStatus,
        amount: row.amount,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
    };
}

function holdToView(row: HoldRow): MarketHoldView {
    return {
        holdId: row.holdId,
        intentId: row.intentId,
        listingId: row.listingId,
        amount: row.amount,
        status: row.status as MarketHoldStatus,
        createdAt: row.createdAt.toISOString(),
    };
}

function tradeToView(row: TradeRow): MarketTradeView {
    return {
        tradeId: row.tradeId,
        listingId: row.listingId,
        itemInstanceId: row.itemInstanceId,
        buyerId: row.buyerId,
        sellerId: row.sellerId,
        price: row.price,
        fee: row.fee,
        sellerProceeds: row.sellerProceeds,
        createdAt: row.createdAt.toISOString(),
    };
}

export class MarketService {
    private async transaction<T>(operation: (tx: MarketDb) => Promise<T>) {
        return db.transaction(async (tx) => operation(tx as unknown as MarketDb));
    }

    private async listingWithItem(database: MarketDb, listingId: string): Promise<JoinedListingRow | undefined> {
        const rows = await withForUpdate(
            database
                .select({
                    listing: marketListingsTable,
                    item: worldItemInstancesTable,
                })
                .from(marketListingsTable)
                .innerJoin(
                    worldItemInstancesTable,
                    eq(marketListingsTable.itemInstanceId, worldItemInstancesTable.instanceId),
                )
                .where(eq(marketListingsTable.listingId, listingId)),
        );
        const row = rows[0];
        return row ? { ...row.listing, item: row.item } : undefined;
    }

    private async listingWithRequest(
        database: MarketDb,
        sellerId: string,
        clientRequestId: string,
    ): Promise<JoinedListingRow | undefined> {
        const rows = await withForUpdate(
            database
                .select({
                    listing: marketListingsTable,
                    item: worldItemInstancesTable,
                })
                .from(marketListingsTable)
                .innerJoin(
                    worldItemInstancesTable,
                    eq(marketListingsTable.itemInstanceId, worldItemInstancesTable.instanceId),
                )
                .where(
                    and(
                        eq(marketListingsTable.sellerId, sellerId),
                        eq(marketListingsTable.clientRequestId, clientRequestId),
                    ),
                ),
        );
        const row = rows[0];
        return row ? { ...row.listing, item: row.item } : undefined;
    }

    private async intentWithRequest(
        database: MarketDb,
        buyerId: string,
        clientRequestId: string,
    ): Promise<IntentRow | undefined> {
        const rows = await withForUpdate(
            database
                .select()
                .from(marketIntentsTable)
                .where(
                    and(
                        eq(marketIntentsTable.buyerId, buyerId),
                        eq(marketIntentsTable.clientRequestId, clientRequestId),
                    ),
                ),
        );
        return rows[0];
    }

    private async activeIntentRows(database: MarketDb, listingId: string, type?: "bid" | "offer") {
        return database
            .select()
            .from(marketIntentsTable)
            .where(
                and(
                    eq(marketIntentsTable.listingId, listingId),
                    eq(marketIntentsTable.status, ACTIVE_INTENT_STATUS),
                    ...(type ? [eq(marketIntentsTable.type, type)] : []),
                ),
            )
            .orderBy(desc(marketIntentsTable.amount), asc(marketIntentsTable.createdAt));
    }

    private async holdForIntent(database: MarketDb, intentId: string): Promise<HoldRow | undefined> {
        const rows = await withForUpdate(
            database
                .select()
                .from(marketWalletHoldsTable)
                .where(
                    and(
                        eq(marketWalletHoldsTable.intentId, intentId),
                        eq(marketWalletHoldsTable.status, ACTIVE_HOLD_STATUS),
                    ),
                ),
        );
        return rows[0];
    }

    private async walletBalance(database: MarketDb, userId: string) {
        const result = await database
            .select({ balance: sql<number>`coalesce(sum(${walletTransactionsTable.amount}), 0)` })
            .from(walletTransactionsTable)
            .where(eq(walletTransactionsTable.userId, userId));
        return Number(result[0]?.balance ?? 0);
    }

    private async requireBalance(database: MarketDb, userId: string, amount: number, extraHeld = 0) {
        const balance = await this.walletBalance(database, userId);
        if (balance + extraHeld < amount) throw new MarketServiceError("insufficient_points");
    }

    private async createHold(
        database: MarketDb,
        input: { userId: string; listingId: string; intentId: string; amount: number; reason: string },
    ) {
        const holdId = randomUUID();
        await database.insert(walletTransactionsTable).values({
            userId: input.userId,
            amount: -input.amount,
            reason: input.reason,
        });
        await database.insert(marketWalletHoldsTable).values({
            holdId,
            userId: input.userId,
            listingId: input.listingId,
            intentId: input.intentId,
            amount: input.amount,
            status: ACTIVE_HOLD_STATUS,
        });
        return holdId;
    }

    private async releaseIntent(database: MarketDb, intent: IntentRow, status: MarketIntentStatus, now = new Date()) {
        const hold = await this.holdForIntent(database, intent.intentId);
        if (hold) {
            await database.update(marketWalletHoldsTable).set({ status: "released", updatedAt: now }).where(
                eq(marketWalletHoldsTable.holdId, hold.holdId),
            );
            await database.insert(walletTransactionsTable).values({
                userId: hold.userId,
                amount: hold.amount,
                reason: "market_hold_release",
            });
        }
        await database.update(marketIntentsTable).set({ status, updatedAt: now }).where(
            eq(marketIntentsTable.intentId, intent.intentId),
        );
    }

    private async releaseOtherActiveIntents(
        database: MarketDb,
        listingId: string,
        acceptedIntentId: string,
        status: MarketIntentStatus,
        now = new Date(),
    ) {
        const intents = await this.activeIntentRows(database, listingId);
        for (const intent of intents) {
            if (intent.intentId === acceptedIntentId) continue;
            await this.releaseIntent(database, intent, status, now);
        }
    }

    private async settleTrade(
        database: MarketDb,
        input: {
            listing: JoinedListingRow;
            buyerId: string;
            price: number;
            acceptedIntent?: IntentRow;
            now?: Date;
        },
    ) {
        const now = input.now ?? new Date();
        if (input.listing.sellerId === input.buyerId) throw new MarketServiceError("own_listing");
        if (input.listing.status !== ACTIVE_LISTING_STATUS) throw new MarketServiceError("listing_not_active");
        if (input.listing.item.state !== "listed") throw new MarketServiceError("item_not_listed");
        if (input.listing.item.userId !== input.listing.sellerId) throw new MarketServiceError("item_owner_mismatch");

        const price = positiveInt(input.price, "price");
        const fee = feeFor(price);
        const sellerProceeds = price - fee;
        const tradeId = randomUUID();

        if (input.acceptedIntent) {
            const hold = await this.holdForIntent(database, input.acceptedIntent.intentId);
            if (!hold || hold.amount !== price) throw new MarketServiceError("hold_not_active");
            await database.update(marketWalletHoldsTable).set({ status: "committed", updatedAt: now }).where(
                eq(marketWalletHoldsTable.holdId, hold.holdId),
            );
            await database.update(marketIntentsTable).set({ status: "accepted", updatedAt: now }).where(
                eq(marketIntentsTable.intentId, input.acceptedIntent.intentId),
            );
        } else {
            await this.requireBalance(database, input.buyerId, price);
            await database.insert(walletTransactionsTable).values({
                userId: input.buyerId,
                amount: -price,
                reason: "market_purchase",
            });
        }

        if (sellerProceeds > 0) {
            await database.insert(walletTransactionsTable).values({
                userId: input.listing.sellerId,
                amount: sellerProceeds,
                reason: "market_sale",
            });
        }

        const transferredItems = await database.update(worldItemInstancesTable).set({
            userId: input.buyerId,
            lifeId: null,
            state: "stash",
            updatedAt: now,
        }).where(
            and(
                eq(worldItemInstancesTable.instanceId, input.listing.itemInstanceId),
                eq(worldItemInstancesTable.userId, input.listing.sellerId),
                eq(worldItemInstancesTable.state, "listed"),
                isNull(worldItemInstancesTable.lifeId),
            ),
        ).returning({ instanceId: worldItemInstancesTable.instanceId });
        if (transferredItems.length !== 1) throw new MarketServiceError("item_transfer_conflict");

        const completedListings = await database.update(marketListingsTable).set({
            status: "sold",
            currentPrice: price,
            updatedAt: now,
        }).where(
            and(
                eq(marketListingsTable.listingId, input.listing.listingId),
                eq(marketListingsTable.status, ACTIVE_LISTING_STATUS),
            ),
        ).returning({ listingId: marketListingsTable.listingId });
        if (completedListings.length !== 1) throw new MarketServiceError("listing_state_conflict");

        await this.releaseOtherActiveIntents(
            database,
            input.listing.listingId,
            input.acceptedIntent?.intentId ?? "",
            input.listing.mode === "auction" ? "outbid" : "rejected",
            now,
        );

        await database.insert(marketTradesTable).values({
            tradeId,
            listingId: input.listing.listingId,
            itemInstanceId: input.listing.itemInstanceId,
            buyerId: input.buyerId,
            sellerId: input.listing.sellerId,
            price,
            fee,
            sellerProceeds,
        });

        return tradeId;
    }

    private async expireListing(database: MarketDb, listing: JoinedListingRow, now = new Date()) {
        if (listing.status !== ACTIVE_LISTING_STATUS) return;

        if (listing.mode === "auction") {
            const bids = await this.activeIntentRows(database, listing.listingId, "bid");
            const winningBid = bids[0];
            if (winningBid) {
                await this.settleTrade(database, {
                    listing,
                    buyerId: winningBid.buyerId,
                    price: winningBid.amount,
                    acceptedIntent: winningBid,
                    now,
                });
                return;
            }
        }

        const intents = await this.activeIntentRows(database, listing.listingId);
        for (const intent of intents) {
            await this.releaseIntent(database, intent, "expired", now);
        }
        const returnedItems = await database.update(worldItemInstancesTable).set({
            state: "stash",
            lifeId: null,
            updatedAt: now,
        }).where(
            and(
                eq(worldItemInstancesTable.instanceId, listing.itemInstanceId),
                eq(worldItemInstancesTable.userId, listing.sellerId),
                eq(worldItemInstancesTable.state, "listed"),
            ),
        ).returning({ instanceId: worldItemInstancesTable.instanceId });
        if (returnedItems.length !== 1) throw new MarketServiceError("item_return_conflict");
        const expiredListings = await database.update(marketListingsTable).set({
            status: "expired",
            updatedAt: now,
        }).where(
            and(
                eq(marketListingsTable.listingId, listing.listingId),
                eq(marketListingsTable.status, ACTIVE_LISTING_STATUS),
            ),
        ).returning({ listingId: marketListingsTable.listingId });
        if (expiredListings.length !== 1) throw new MarketServiceError("listing_state_conflict");
    }

    async settleExpiredIntents(now = new Date()) {
        const expired = await db
            .select()
            .from(marketIntentsTable)
            .where(
                and(
                    eq(marketIntentsTable.status, ACTIVE_INTENT_STATUS),
                    eq(marketIntentsTable.type, "offer"),
                    lte(marketIntentsTable.expiresAt, now),
                ),
            );

        for (const row of expired) {
            await this.transaction(async (tx) => {
                const intent = (await withForUpdate(
                    tx.select().from(marketIntentsTable).where(eq(marketIntentsTable.intentId, row.intentId)),
                ))[0];
                if (!intent || intent.status !== ACTIVE_INTENT_STATUS || intent.expiresAt > now) return;
                await this.releaseIntent(tx, intent, "expired", now);
            });
        }
    }

    async settleExpiredListings(now = new Date()) {
        const expired = await db
            .select({
                listing: marketListingsTable,
                item: worldItemInstancesTable,
            })
            .from(marketListingsTable)
            .innerJoin(
                worldItemInstancesTable,
                eq(marketListingsTable.itemInstanceId, worldItemInstancesTable.instanceId),
            )
            .where(
                and(
                    eq(marketListingsTable.status, ACTIVE_LISTING_STATUS),
                    lte(marketListingsTable.expiresAt, now),
                ),
            );

        for (const row of expired) {
            await this.transaction(async (tx) => {
                const listing = await this.listingWithItem(tx, row.listing.listingId);
                if (!listing || listing.status !== ACTIVE_LISTING_STATUS || listing.expiresAt > now) return;
                await this.expireListing(tx, listing, now);
            });
        }
    }

    async settleExpiredMarket(now = new Date()) {
        await this.settleExpiredListings(now);
        await this.settleExpiredIntents(now);
    }

    async listListings(filters: MarketListFilters = {}): Promise<MarketListingsResponse> {
        await this.settleExpiredMarket();
        const priceExpression = sql<
            number
        >`coalesce(${marketListingsTable.currentPrice}, ${marketListingsTable.price}, 0)`;
        const conditions = [eq(marketListingsTable.status, ACTIVE_LISTING_STATUS)];
        if (filters.mode) conditions.push(eq(marketListingsTable.mode, filters.mode));
        if (filters.type) conditions.push(eq(worldItemInstancesTable.type, filters.type));
        if (filters.minPrice !== undefined) conditions.push(gte(priceExpression, filters.minPrice));
        if (filters.maxPrice !== undefined) conditions.push(lte(priceExpression, filters.maxPrice));
        if (filters.minDurability !== undefined) {
            conditions.push(gte(worldItemInstancesTable.durability, filters.minDurability));
        }
        if (filters.maxDurability !== undefined) {
            conditions.push(lte(worldItemInstancesTable.durability, filters.maxDurability));
        }

        const orderBy = filters.sort === "price_asc"
            ? [asc(priceExpression)]
            : filters.sort === "price_desc"
            ? [desc(priceExpression)]
            : filters.sort === "durability_desc"
            ? [desc(worldItemInstancesTable.durability)]
            : [desc(marketListingsTable.createdAt)];
        const limit = Math.max(1, Math.min(MAX_LISTING_LIMIT, Math.trunc(filters.limit ?? 50)));
        const offset = Math.max(0, Math.trunc(filters.offset ?? 0));

        const rows = await db
            .select({
                listing: marketListingsTable,
                item: worldItemInstancesTable,
            })
            .from(marketListingsTable)
            .innerJoin(
                worldItemInstancesTable,
                eq(marketListingsTable.itemInstanceId, worldItemInstancesTable.instanceId),
            )
            .where(and(...conditions))
            .orderBy(...orderBy)
            .limit(limit)
            .offset(offset);

        return {
            listings: rows.map((row) => listingToView({ ...row.listing, item: row.item })),
        };
    }

    async getMine(userId: string): Promise<MarketMineResponse> {
        await this.settleExpiredMarket();
        const [listingRows, intents, receivedIntents, holds, buyerTrades, sellerTrades] = await Promise.all([
            db
                .select({
                    listing: marketListingsTable,
                    item: worldItemInstancesTable,
                })
                .from(marketListingsTable)
                .innerJoin(
                    worldItemInstancesTable,
                    eq(marketListingsTable.itemInstanceId, worldItemInstancesTable.instanceId),
                )
                .where(eq(marketListingsTable.sellerId, userId))
                .orderBy(desc(marketListingsTable.createdAt)),
            db.select().from(marketIntentsTable).where(eq(marketIntentsTable.buyerId, userId)).orderBy(
                desc(marketIntentsTable.createdAt),
            ),
            db
                .select({
                    intent: marketIntentsTable,
                })
                .from(marketIntentsTable)
                .innerJoin(marketListingsTable, eq(marketIntentsTable.listingId, marketListingsTable.listingId))
                .where(eq(marketListingsTable.sellerId, userId))
                .orderBy(desc(marketIntentsTable.createdAt)),
            db.select().from(marketWalletHoldsTable).where(eq(marketWalletHoldsTable.userId, userId)).orderBy(
                desc(marketWalletHoldsTable.createdAt),
            ),
            db.select().from(marketTradesTable).where(eq(marketTradesTable.buyerId, userId)).orderBy(
                desc(marketTradesTable.createdAt),
            ),
            db.select().from(marketTradesTable).where(eq(marketTradesTable.sellerId, userId)).orderBy(
                desc(marketTradesTable.createdAt),
            ),
        ]);
        const tradeIds = new Set<string>();
        const mineTrades = [...buyerTrades, ...sellerTrades].filter((trade) => {
            if (tradeIds.has(trade.tradeId)) return false;
            tradeIds.add(trade.tradeId);
            return true;
        });

        return {
            listings: listingRows.map((row) => listingToView({ ...row.listing, item: row.item })),
            intents: intents.map(intentToView),
            receivedIntents: receivedIntents.map((row) => intentToView(row.intent)),
            holds: holds.map(holdToView),
            trades: mineTrades.map(tradeToView),
        };
    }

    async createListing(userId: string, input: CreateMarketListingInput) {
        const price = input.price === null || input.price === undefined ? null : positiveInt(input.price, "price");
        if (input.mode !== "offers" && price === null) throw new MarketServiceError("price_required");
        await this.settleExpiredMarket();
        const now = new Date();
        const expiresAt = new Date(
            now.getTime() + (input.mode === "auction" ? MARKET_AUCTION_DURATION_MS : MARKET_FIXED_PRICE_DURATION_MS),
        );
        const listingId = randomUUID();
        let existingListing: JoinedListingRow | undefined;

        await this.transaction(async (tx) => {
            existingListing = await this.listingWithRequest(tx, userId, input.clientRequestId);
            if (existingListing) return;

            await withForUpdate(tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)));
            const item = (await withForUpdate(
                tx.select().from(worldItemInstancesTable).where(
                    and(
                        eq(worldItemInstancesTable.instanceId, input.itemInstanceId),
                        eq(worldItemInstancesTable.userId, userId),
                    ),
                ),
            ))[0];
            if (!item) throw new MarketServiceError("item_not_found");
            if (item.state !== "stash") throw new MarketServiceError("item_not_stash");
            if (item.quantity <= 0) throw new MarketServiceError("item_empty");

            const activeListings = await tx.select({ listingId: marketListingsTable.listingId })
                .from(marketListingsTable)
                .where(
                    and(
                        eq(marketListingsTable.itemInstanceId, item.instanceId),
                        eq(marketListingsTable.status, ACTIVE_LISTING_STATUS),
                    ),
                );
            if (activeListings.length) throw new MarketServiceError("item_already_listed");

            const listedItems = await tx.update(worldItemInstancesTable).set({
                state: "listed",
                lifeId: null,
                updatedAt: now,
            }).where(
                and(
                    eq(worldItemInstancesTable.instanceId, item.instanceId),
                    eq(worldItemInstancesTable.userId, userId),
                    eq(worldItemInstancesTable.state, "stash"),
                    isNull(worldItemInstancesTable.lifeId),
                ),
            ).returning({ instanceId: worldItemInstancesTable.instanceId });
            if (listedItems.length !== 1) throw new MarketServiceError("item_list_conflict");
            await tx.insert(marketListingsTable).values({
                listingId,
                sellerId: userId,
                itemInstanceId: item.instanceId,
                mode: input.mode,
                status: ACTIVE_LISTING_STATUS,
                price,
                currentPrice: input.mode === "offers" ? null : price,
                clientRequestId: input.clientRequestId,
                expiresAt,
            });
        });

        if (existingListing) return listingToView(existingListing);
        const listing = await this.listingWithItem(db, listingId);
        if (!listing) throw new MarketServiceError("listing_not_found");
        return listingToView(listing);
    }

    async cancelListing(userId: string, listingId: string) {
        await this.settleExpiredMarket();
        let result: MarketListingView | undefined;
        await this.transaction(async (tx) => {
            const listing = await this.listingWithItem(tx, listingId);
            if (!listing) throw new MarketServiceError("listing_not_found");
            if (listing.sellerId !== userId) throw new MarketServiceError("forbidden");
            if (listing.status !== ACTIVE_LISTING_STATUS) throw new MarketServiceError("listing_not_active");
            const activeIntents = await this.activeIntentRows(tx, listingId);
            if (listing.mode === "auction" && activeIntents.length > 0) {
                throw new MarketServiceError("auction_has_bid");
            }
            for (const intent of activeIntents) {
                await this.releaseIntent(tx, intent, "cancelled");
            }
            const returnedItems = await tx.update(worldItemInstancesTable).set({
                state: "stash",
                lifeId: null,
                updatedAt: new Date(),
            }).where(
                and(
                    eq(worldItemInstancesTable.instanceId, listing.itemInstanceId),
                    eq(worldItemInstancesTable.userId, userId),
                    eq(worldItemInstancesTable.state, "listed"),
                ),
            ).returning({ instanceId: worldItemInstancesTable.instanceId });
            if (returnedItems.length !== 1) throw new MarketServiceError("item_return_conflict");
            const cancelledListings = await tx.update(marketListingsTable).set({
                status: "cancelled",
                updatedAt: new Date(),
            }).where(
                and(
                    eq(marketListingsTable.listingId, listingId),
                    eq(marketListingsTable.status, ACTIVE_LISTING_STATUS),
                ),
            ).returning({ listingId: marketListingsTable.listingId });
            if (cancelledListings.length !== 1) throw new MarketServiceError("listing_state_conflict");
            result = listingToView({
                ...listing,
                status: "cancelled",
                item: { ...listing.item, state: "stash" },
            });
        });
        return result!;
    }

    async buyListing(userId: string, listingId: string) {
        await this.settleExpiredMarket();
        let tradeId = "";
        await this.transaction(async (tx) => {
            const listing = await this.listingWithItem(tx, listingId);
            if (!listing) throw new MarketServiceError("listing_not_found");
            if (listing.mode !== "fixed_price") throw new MarketServiceError("not_fixed_price");
            if (!listing.price || listing.expiresAt <= new Date()) throw new MarketServiceError("listing_expired");
            tradeId = await this.settleTrade(tx, {
                listing,
                buyerId: userId,
                price: listing.price,
            });
        });
        const trade = (await db.select().from(marketTradesTable).where(eq(marketTradesTable.tradeId, tradeId)))[0];
        if (!trade) throw new MarketServiceError("trade_not_found");
        return tradeToView(trade);
    }

    async bid(userId: string, listingId: string, amount: number, clientRequestId: string) {
        await this.settleExpiredMarket();
        amount = positiveInt(amount, "amount");
        const intentId = randomUUID();
        let existingIntent: IntentRow | undefined;
        await this.transaction(async (tx) => {
            existingIntent = await this.intentWithRequest(tx, userId, clientRequestId);
            if (existingIntent) return;

            const listing = await this.listingWithItem(tx, listingId);
            if (!listing) throw new MarketServiceError("listing_not_found");
            if (listing.mode !== "auction") throw new MarketServiceError("not_auction");
            if (listing.status !== ACTIVE_LISTING_STATUS || listing.expiresAt <= new Date()) {
                throw new MarketServiceError("listing_expired");
            }
            if (listing.sellerId === userId) throw new MarketServiceError("own_listing");

            const activeBids = await this.activeIntentRows(tx, listingId, "bid");
            const highest = activeBids[0];
            const minimumBid = highest ? highest.amount + 1 : listing.price ?? 1;
            if (amount < minimumBid) throw new MarketServiceError("bid_too_low");
            const ownHeld = activeBids
                .filter((bid) => bid.buyerId === userId)
                .reduce((total, bid) => total + bid.amount, 0);
            await this.requireBalance(tx, userId, amount, ownHeld);

            for (const bid of activeBids) {
                await this.releaseIntent(tx, bid, "outbid");
            }
            await tx.insert(marketIntentsTable).values({
                intentId,
                listingId,
                buyerId: userId,
                type: "bid",
                status: ACTIVE_INTENT_STATUS,
                amount,
                clientRequestId,
                expiresAt: listing.expiresAt,
            });
            await this.createHold(tx, {
                userId,
                listingId,
                intentId,
                amount,
                reason: "market_bid_hold",
            });
            await tx.update(marketListingsTable).set({ currentPrice: amount, updatedAt: new Date() }).where(
                eq(marketListingsTable.listingId, listingId),
            );
        });
        if (existingIntent) return intentToView(existingIntent);
        const intent = (await db.select().from(marketIntentsTable).where(eq(marketIntentsTable.intentId, intentId)))[0];
        if (!intent) throw new MarketServiceError("intent_not_found");
        return intentToView(intent);
    }

    async offer(userId: string, listingId: string, amount: number, clientRequestId: string) {
        await this.settleExpiredMarket();
        amount = positiveInt(amount, "amount");
        const intentId = randomUUID();
        let existingIntent: IntentRow | undefined;
        await this.transaction(async (tx) => {
            existingIntent = await this.intentWithRequest(tx, userId, clientRequestId);
            if (existingIntent) return;

            const listing = await this.listingWithItem(tx, listingId);
            if (!listing) throw new MarketServiceError("listing_not_found");
            if (listing.mode !== "offers") throw new MarketServiceError("not_offer_listing");
            if (listing.status !== ACTIVE_LISTING_STATUS || listing.expiresAt <= new Date()) {
                throw new MarketServiceError("listing_expired");
            }
            if (listing.sellerId === userId) throw new MarketServiceError("own_listing");
            await this.requireBalance(tx, userId, amount);
            await tx.insert(marketIntentsTable).values({
                intentId,
                listingId,
                buyerId: userId,
                type: "offer",
                status: ACTIVE_INTENT_STATUS,
                amount,
                clientRequestId,
                expiresAt: new Date(Date.now() + MARKET_OFFER_DURATION_MS),
            });
            await this.createHold(tx, {
                userId,
                listingId,
                intentId,
                amount,
                reason: "market_offer_hold",
            });
        });
        if (existingIntent) return intentToView(existingIntent);
        const intent = (await db.select().from(marketIntentsTable).where(eq(marketIntentsTable.intentId, intentId)))[0];
        if (!intent) throw new MarketServiceError("intent_not_found");
        return intentToView(intent);
    }

    async acceptOffer(userId: string, intentId: string) {
        await this.settleExpiredMarket();
        let tradeId = "";
        let expired = false;
        await this.transaction(async (tx) => {
            const intent = (await withForUpdate(
                tx.select().from(marketIntentsTable).where(eq(marketIntentsTable.intentId, intentId)),
            ))[0];
            if (!intent) throw new MarketServiceError("offer_not_found");
            if (intent.type !== "offer" || intent.status !== ACTIVE_INTENT_STATUS) {
                throw new MarketServiceError("offer_not_active");
            }
            if (intent.expiresAt <= new Date()) {
                await this.releaseIntent(tx, intent, "expired");
                expired = true;
                return;
            }
            const listing = await this.listingWithItem(tx, intent.listingId);
            if (!listing) throw new MarketServiceError("listing_not_found");
            if (listing.sellerId !== userId) throw new MarketServiceError("forbidden");
            if (listing.mode !== "offers") throw new MarketServiceError("not_offer_listing");
            tradeId = await this.settleTrade(tx, {
                listing,
                buyerId: intent.buyerId,
                price: intent.amount,
                acceptedIntent: intent,
            });
        });
        if (expired) throw new MarketServiceError("offer_expired");
        const trade = (await db.select().from(marketTradesTable).where(eq(marketTradesTable.tradeId, tradeId)))[0];
        if (!trade) throw new MarketServiceError("trade_not_found");
        return tradeToView(trade);
    }

    async rejectOffer(userId: string, intentId: string) {
        await this.settleExpiredMarket();
        let result: MarketIntentView | undefined;
        await this.transaction(async (tx) => {
            const intent = (await withForUpdate(
                tx.select().from(marketIntentsTable).where(eq(marketIntentsTable.intentId, intentId)),
            ))[0];
            if (!intent) throw new MarketServiceError("offer_not_found");
            if (intent.type !== "offer" || intent.status !== ACTIVE_INTENT_STATUS) {
                throw new MarketServiceError("offer_not_active");
            }
            const listing = await this.listingWithItem(tx, intent.listingId);
            if (!listing || listing.sellerId !== userId) throw new MarketServiceError("forbidden");
            await this.releaseIntent(tx, intent, "rejected");
            result = intentToView({ ...intent, status: "rejected" });
        });
        return result!;
    }

    async cancelOffer(userId: string, intentId: string) {
        await this.settleExpiredMarket();
        let result: MarketIntentView | undefined;
        await this.transaction(async (tx) => {
            const intent = (await withForUpdate(
                tx.select().from(marketIntentsTable).where(eq(marketIntentsTable.intentId, intentId)),
            ))[0];
            if (!intent) throw new MarketServiceError("offer_not_found");
            if (intent.type !== "offer" || intent.status !== ACTIVE_INTENT_STATUS) {
                throw new MarketServiceError("offer_not_active");
            }
            if (intent.buyerId !== userId) throw new MarketServiceError("forbidden");
            await this.releaseIntent(tx, intent, "cancelled");
            result = intentToView({ ...intent, status: "cancelled" });
        });
        return result!;
    }
}

export class MarketServiceError extends Error {
    constructor(public readonly code: string) {
        super(code);
    }
}

export const marketService = new MarketService();
