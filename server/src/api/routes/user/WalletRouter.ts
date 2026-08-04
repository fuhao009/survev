import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { WalletOverviewResponse } from "../../../../../shared/types/wallet.ts";
import { db } from "../../db/index.ts";
import { walletTransactionsTable } from "../../db/schema.ts";
import type { Context } from "../../index.ts";

export const WalletRouter = new Hono<Context>().get("/", async (c) => {
    const user = c.get("user")!;

    const [balanceResult, ledger] = await Promise.all([
        db
            .select({ balance: sql<number>`coalesce(sum(${walletTransactionsTable.amount}), 0)` })
            .from(walletTransactionsTable)
            .where(eq(walletTransactionsTable.userId, user.id)),
        db
            .select({
                id: walletTransactionsTable.id,
                amount: walletTransactionsTable.amount,
                reason: walletTransactionsTable.reason,
                createdAt: walletTransactionsTable.createdAt,
            })
            .from(walletTransactionsTable)
            .where(eq(walletTransactionsTable.userId, user.id))
            .orderBy(desc(walletTransactionsTable.createdAt), desc(walletTransactionsTable.id)),
    ]);

    const balance = Number(balanceResult[0]?.balance ?? 0);

    return c.json<WalletOverviewResponse>({
        balance,
        ledger: ledger.map((entry) => ({
            ...entry,
            createdAt: entry.createdAt.toISOString(),
        })),
    }, 200);
});
