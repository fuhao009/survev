import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { MARKET_AUCTION_DURATION_MS, MARKET_OFFER_DURATION_MS } from "../../shared/types/market.ts";

process.env.SURVEV_DB_DRIVER = "sqlite";
process.env.SURVEV_DATABASE_PATH = join(
    tmpdir(),
    `survev-market-${process.pid}-${Date.now()}-${randomUUID()}.sqlite`,
);

const { db } = await import("../../server/src/api/db/index.ts");
const {
    marketIntentsTable,
    marketListingsTable,
    marketTradesTable,
    marketWalletHoldsTable,
    usersTable,
    walletTransactionsTable,
    worldItemInstancesTable,
} = await import("../../server/src/api/db/schema.sqlite.ts");
const { marketService } = await import("../../server/src/api/market/MarketService.ts");
const { worldService } = await import("../../server/src/api/world/worldService.ts");

async function createUser(id: string) {
    await db.insert(usersTable).values({
        id,
        authId: `auth-${id}`,
        slug: `slug-${id}`,
    });
}

async function fund(userId: string, amount: number) {
    await db.insert(walletTransactionsTable).values({
        userId,
        amount,
        reason: "test_funding",
    });
}

async function createItem(input: {
    instanceId?: string;
    userId: string;
    type?: string;
    quantity?: number;
    durability?: number;
    durabilityMax?: number;
    state?: string;
}) {
    const instanceId = input.instanceId ?? randomUUID();
    await db.insert(worldItemInstancesTable).values({
        instanceId,
        userId: input.userId,
        type: input.type ?? "ak47",
        quantity: input.quantity ?? 1,
        durability: input.durability ?? 1000,
        durabilityMax: input.durabilityMax ?? 1000,
        state: input.state ?? "stash",
    });
    return instanceId;
}

async function balance(userId: string) {
    const rows = await db.select().from(walletTransactionsTable);
    return rows
        .filter((row) => row.userId === userId)
        .reduce((total, row) => total + row.amount, 0);
}

async function expectMarketError(promise: Promise<unknown>, code: string) {
    await expect(promise).rejects.toMatchObject({ code });
}

beforeEach(async () => {
    await db.delete(marketTradesTable);
    await db.delete(marketWalletHoldsTable);
    await db.delete(marketIntentsTable);
    await db.delete(marketListingsTable);
    await db.delete(worldItemInstancesTable);
    await db.delete(walletTransactionsTable);
    await db.delete(usersTable);
});

describe("market service", () => {
    test("retries create and bid requests idempotently", async () => {
        const seller = "seller-idempotent";
        const buyer = "buyer-idempotent";
        await createUser(seller);
        await createUser(buyer);
        await fund(buyer, 100);
        const itemInstanceId = await createItem({ userId: seller });

        const firstListing = await marketService.createListing(seller, {
            itemInstanceId,
            mode: "auction",
            price: 10,
            clientRequestId: "same-listing-request",
        });
        const retryListing = await marketService.createListing(seller, {
            itemInstanceId,
            mode: "fixed_price",
            price: 999,
            clientRequestId: "same-listing-request",
        });
        expect(retryListing.listingId).toBe(firstListing.listingId);
        expect(await db.select().from(marketListingsTable)).toHaveLength(1);

        const firstBid = await marketService.bid(
            buyer,
            firstListing.listingId,
            20,
            "same-bid-request",
        );
        const retryBid = await marketService.bid(
            buyer,
            firstListing.listingId,
            90,
            "same-bid-request",
        );
        expect(retryBid.intentId).toBe(firstBid.intentId);
        expect(await db.select().from(marketIntentsTable)).toHaveLength(1);
        expect(await balance(buyer)).toBe(80);
    });

    test("settles a fixed-price purchase and preserves stack quantity", async () => {
        const seller = "seller-fixed";
        const buyer = "buyer-fixed";
        await createUser(seller);
        await createUser(buyer);
        await fund(buyer, 100);
        const itemInstanceId = await createItem({
            userId: seller,
            type: "bandage",
            quantity: 3,
            durability: 0,
            durabilityMax: 0,
        });

        const listing = await marketService.createListing(seller, {
            itemInstanceId,
            mode: "fixed_price",
            price: 40,
            clientRequestId: "fixed-listing-1",
        });
        expect(listing.item.state).toBe("listed");

        const trade = await marketService.buyListing(buyer, listing.listingId);
        expect(trade).toMatchObject({
            price: 40,
            fee: 2,
            sellerProceeds: 38,
            buyerId: buyer,
            sellerId: seller,
        });

        const item = (await db.select().from(worldItemInstancesTable))
            .find((row) => row.instanceId === itemInstanceId);
        expect(item).toMatchObject({
            userId: buyer,
            state: "stash",
            quantity: 3,
        });
        expect(await balance(buyer)).toBe(60);
        expect(await balance(seller)).toBe(38);
    });

    test("rejects self-purchase and insufficient balance without releasing the item", async () => {
        const seller = "seller-guard";
        const buyer = "buyer-guard";
        await createUser(seller);
        await createUser(buyer);
        await fund(buyer, 10);
        const itemInstanceId = await createItem({ userId: seller });
        const listing = await marketService.createListing(seller, {
            itemInstanceId,
            mode: "fixed_price",
            price: 20,
            clientRequestId: "guard-listing-1",
        });

        await expectMarketError(
            marketService.buyListing(seller, listing.listingId),
            "own_listing",
        );
        await expectMarketError(
            marketService.buyListing(buyer, listing.listingId),
            "insufficient_points",
        );

        const item = (await db.select().from(worldItemInstancesTable))
            .find((row) => row.instanceId === itemInstanceId);
        const storedListing = (await db.select().from(marketListingsTable))
            .find((row) => row.listingId === listing.listingId);
        expect(item).toMatchObject({ userId: seller, state: "listed" });
        expect(storedListing).toMatchObject({ status: "active" });
    });

    test("rolls back a stale item transfer conflict without moving points", async () => {
        const seller = "seller-stale-transfer";
        const buyer = "buyer-stale-transfer";
        await createUser(seller);
        await createUser(buyer);
        await fund(buyer, 100);
        const itemInstanceId = await createItem({ userId: seller });
        const listing = await marketService.createListing(seller, {
            itemInstanceId,
            mode: "fixed_price",
            price: 20,
            clientRequestId: "stale-transfer-listing",
        });
        const listingRow = (await db.select().from(marketListingsTable))
            .find((row) => row.listingId === listing.listingId)!;
        const itemRow = (await db.select().from(worldItemInstancesTable))
            .find((row) => row.instanceId === itemInstanceId)!;

        await db.update(worldItemInstancesTable).set({ state: "stash" });

        const privateMarketService = marketService as unknown as {
            settleTrade(
                database: typeof db,
                input: {
                    listing: typeof listingRow & { item: typeof itemRow };
                    buyerId: string;
                    price: number;
                },
            ): Promise<string>;
        };
        await expectMarketError(
            db.transaction(async (tx) =>
                privateMarketService.settleTrade(tx as typeof db, {
                    listing: { ...listingRow, item: itemRow },
                    buyerId: buyer,
                    price: 20,
                })
            ),
            "item_transfer_conflict",
        );

        expect(await balance(buyer)).toBe(100);
        expect(await balance(seller)).toBe(0);
        expect(await db.select().from(marketTradesTable)).toHaveLength(0);
        const storedListing = (await db.select().from(marketListingsTable))
            .find((row) => row.listingId === listing.listingId);
        expect(storedListing).toMatchObject({ status: "active" });
    });

    test("only stashes can be listed and warehouse gear is not auto-carried into world entry", async () => {
        const seller = "seller-state";
        await createUser(seller);
        const carriedId = await createItem({ userId: seller, state: "carried" });
        const stashId = await createItem({ userId: seller, state: "stash" });
        const listedId = await createItem({ userId: seller, state: "listed" });

        await expectMarketError(
            marketService.createListing(seller, {
                itemInstanceId: carriedId,
                mode: "fixed_price",
                price: 20,
                clientRequestId: "state-listing-1",
            }),
            "item_not_stash",
        );

        const items = await (worldService as typeof worldService & {
            ensureStarterItems(userId: string): Promise<Array<{ instanceId: string }>>;
        }).ensureStarterItems(seller);
        expect(new Set(items.map((item) => item.instanceId))).toEqual(new Set());
        expect(items.map((item) => item.instanceId)).not.toContain(stashId);
        expect(items.map((item) => item.instanceId)).not.toContain(listedId);
    });

    test("freezes bids, releases the outbid bidder, settles the winner, and blocks auction cancellation", async () => {
        const seller = "seller-auction";
        const bidderOne = "bidder-one";
        const bidderTwo = "bidder-two";
        await createUser(seller);
        await createUser(bidderOne);
        await createUser(bidderTwo);
        await fund(bidderOne, 100);
        await fund(bidderTwo, 100);
        const itemInstanceId = await createItem({ userId: seller });
        const listing = await marketService.createListing(seller, {
            itemInstanceId,
            mode: "auction",
            price: 40,
            clientRequestId: "auction-listing-1",
        });

        const firstBid = await marketService.bid(bidderOne, listing.listingId, 40, "auction-bid-1");
        expect(firstBid.status).toBe("active");
        expect(await balance(bidderOne)).toBe(60);

        const winningBid = await marketService.bid(bidderTwo, listing.listingId, 55, "auction-bid-2");
        expect(winningBid.amount).toBe(55);
        expect(await balance(bidderOne)).toBe(100);
        expect(await balance(bidderTwo)).toBe(45);

        const oldBid = (await db.select().from(marketIntentsTable))
            .find((row) => row.intentId === firstBid.intentId);
        const oldHold = (await db.select().from(marketWalletHoldsTable))
            .find((row) => row.intentId === firstBid.intentId);
        expect(oldBid).toMatchObject({ status: "outbid" });
        expect(oldHold).toMatchObject({ status: "released" });

        await expectMarketError(
            marketService.cancelListing(seller, listing.listingId),
            "auction_has_bid",
        );

        await marketService.settleExpiredListings(
            new Date(Date.now() + MARKET_AUCTION_DURATION_MS + 1000),
        );
        const item = (await db.select().from(worldItemInstancesTable))
            .find((row) => row.instanceId === itemInstanceId);
        const trade = (await db.select().from(marketTradesTable))
            .find((row) => row.listingId === listing.listingId);
        expect(item).toMatchObject({ userId: bidderTwo, state: "stash" });
        expect(trade).toMatchObject({ price: 55, fee: 2, sellerProceeds: 53 });
        expect(await balance(bidderTwo)).toBe(45);
        expect(await balance(seller)).toBe(53);
    });

    test("expires an auction without bids and returns the item to stash", async () => {
        const seller = "seller-empty-auction";
        await createUser(seller);
        const itemInstanceId = await createItem({ userId: seller });
        const listing = await marketService.createListing(seller, {
            itemInstanceId,
            mode: "auction",
            price: 10,
            clientRequestId: "auction-empty-1",
        });

        await marketService.settleExpiredListings(
            new Date(Date.now() + MARKET_AUCTION_DURATION_MS + 1000),
        );

        const item = (await db.select().from(worldItemInstancesTable))
            .find((row) => row.instanceId === itemInstanceId);
        const storedListing = (await db.select().from(marketListingsTable))
            .find((row) => row.listingId === listing.listingId);
        expect(item).toMatchObject({ userId: seller, state: "stash" });
        expect(storedListing).toMatchObject({ status: "expired" });
    });

    test("expires direct offers after 24 hours and releases their holds", async () => {
        const seller = "seller-offer-expiry";
        const buyer = "buyer-offer-expiry";
        await createUser(seller);
        await createUser(buyer);
        await fund(buyer, 100);
        const itemInstanceId = await createItem({ userId: seller });
        const listing = await marketService.createListing(seller, {
            itemInstanceId,
            mode: "offers",
            price: null,
            clientRequestId: "offer-expiry-listing",
        });

        const intent = await marketService.offer(
            buyer,
            listing.listingId,
            35,
            "offer-expiry-intent",
        );
        expect(await balance(buyer)).toBe(65);

        await marketService.settleExpiredMarket(
            new Date(Date.now() + MARKET_OFFER_DURATION_MS + 1000),
        );

        const storedIntent = (await db.select().from(marketIntentsTable))
            .find((row) => row.intentId === intent.intentId);
        const hold = (await db.select().from(marketWalletHoldsTable))
            .find((row) => row.intentId === intent.intentId);
        const item = (await db.select().from(worldItemInstancesTable))
            .find((row) => row.instanceId === itemInstanceId);
        expect(storedIntent).toMatchObject({ status: "expired" });
        expect(hold).toMatchObject({ status: "released" });
        expect(item).toMatchObject({ userId: seller, state: "listed" });
        expect(await balance(buyer)).toBe(100);
    });

    test("releases cancelled and rejected offers, then accepts one offer and releases the rest", async () => {
        const seller = "seller-offers";
        const buyerOne = "buyer-offer-one";
        const buyerTwo = "buyer-offer-two";
        await createUser(seller);
        await createUser(buyerOne);
        await createUser(buyerTwo);
        await fund(buyerOne, 100);
        await fund(buyerTwo, 100);
        const itemInstanceId = await createItem({ userId: seller });
        const listing = await marketService.createListing(seller, {
            itemInstanceId,
            mode: "offers",
            price: null,
            clientRequestId: "offers-listing-1",
        });

        const cancelled = await marketService.offer(buyerOne, listing.listingId, 20, "offer-cancel-1");
        expect(await balance(buyerOne)).toBe(80);
        await marketService.cancelOffer(buyerOne, cancelled.intentId);
        expect(await balance(buyerOne)).toBe(100);

        const rejected = await marketService.offer(buyerOne, listing.listingId, 25, "offer-reject-1");
        const accepted = await marketService.offer(buyerTwo, listing.listingId, 30, "offer-accept-1");
        const remaining = await marketService.offer(buyerOne, listing.listingId, 27, "offer-remaining-1");
        expect(await balance(buyerOne)).toBe(48);
        expect(await balance(buyerTwo)).toBe(70);
        const sellerMine = await marketService.getMine(seller);
        expect(sellerMine.receivedIntents.map((intent) => intent.intentId)).toEqual(
            expect.arrayContaining([rejected.intentId, accepted.intentId, remaining.intentId]),
        );
        expect(sellerMine.receivedIntents.filter((intent) => intent.status === "active")).toHaveLength(3);

        await marketService.rejectOffer(seller, rejected.intentId);
        expect(await balance(buyerOne)).toBe(73);
        const trade = await marketService.acceptOffer(seller, accepted.intentId);
        expect(trade).toMatchObject({ price: 30, fee: 1, sellerProceeds: 29 });

        const remainingIntent = (await db.select().from(marketIntentsTable))
            .find((row) => row.intentId === remaining.intentId);
        const item = (await db.select().from(worldItemInstancesTable))
            .find((row) => row.instanceId === itemInstanceId);
        expect(remainingIntent).toMatchObject({ status: "rejected" });
        expect(item).toMatchObject({ userId: buyerTwo, state: "stash" });
        expect(await balance(buyerOne)).toBe(100);
        expect(await balance(buyerTwo)).toBe(70);
        expect(await balance(seller)).toBe(29);
    });
});
