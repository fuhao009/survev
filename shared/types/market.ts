import type { ItemInstance } from "./itemInstance.ts";

export const MARKET_FEE_RATE_BASIS_POINTS = 500;
export const MARKET_FIXED_PRICE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const MARKET_AUCTION_DURATION_MS = 24 * 60 * 60 * 1000;
export const MARKET_OFFER_DURATION_MS = 24 * 60 * 60 * 1000;

export type MarketListingMode = "fixed_price" | "auction" | "offers";
export type MarketListingStatus = "active" | "sold" | "cancelled" | "expired";
export type MarketIntentType = "bid" | "offer";
export type MarketIntentStatus = "active" | "accepted" | "rejected" | "cancelled" | "outbid" | "expired";
export type MarketHoldStatus = "active" | "released" | "committed";

export interface MarketListingView {
    listingId: string;
    sellerId: string;
    item: ItemInstance;
    mode: MarketListingMode;
    status: MarketListingStatus;
    price: number | null;
    currentPrice: number | null;
    createdAt: string;
    expiresAt: string;
}

export interface MarketIntentView {
    intentId: string;
    listingId: string;
    buyerId: string;
    type: MarketIntentType;
    status: MarketIntentStatus;
    amount: number;
    createdAt: string;
    expiresAt: string;
}

export interface MarketTradeView {
    tradeId: string;
    listingId: string;
    itemInstanceId: string;
    buyerId: string;
    sellerId: string;
    price: number;
    fee: number;
    sellerProceeds: number;
    createdAt: string;
}

export interface MarketHoldView {
    holdId: string;
    intentId: string | null;
    listingId: string;
    amount: number;
    status: MarketHoldStatus;
    createdAt: string;
}

export interface MarketListingsResponse {
    listings: MarketListingView[];
}

export interface MarketMineResponse {
    listings: MarketListingView[];
    intents: MarketIntentView[];
    receivedIntents: MarketIntentView[];
    trades: MarketTradeView[];
    holds: MarketHoldView[];
}

export type MarketMutationResponse =
    | { success: true; listing?: MarketListingView; intent?: MarketIntentView; trade?: MarketTradeView }
    | { success: false; error: string };
