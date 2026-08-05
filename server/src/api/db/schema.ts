import { Config } from "../../config.ts";
import * as postgresSchema from "./schema.postgres.ts";
import * as sqliteSchema from "./schema.sqlite.ts";

// Routes import this module so the table objects always match the configured
// Drizzle driver. PostgreSQL remains available for production deployments via
// database.driver or SURVEV_DB_DRIVER=postgres.
const activeSchema = Config.database.driver === "postgres" ? postgresSchema : sqliteSchema;

export const sessionTable = activeSchema.sessionTable as typeof sqliteSchema.sessionTable;
export const usersTable = activeSchema.usersTable as typeof sqliteSchema.usersTable;
export const itemsTable = activeSchema.itemsTable as typeof sqliteSchema.itemsTable;
export const userPassTable = activeSchema.userPassTable as typeof sqliteSchema.userPassTable;
export const walletTransactionsTable = activeSchema
    .walletTransactionsTable as typeof sqliteSchema.walletTransactionsTable;
export const worldShardsTable = activeSchema.worldShardsTable as typeof sqliteSchema.worldShardsTable;
export const worldLivesTable = activeSchema.worldLivesTable as typeof sqliteSchema.worldLivesTable;
export const worldItemInstancesTable = activeSchema
    .worldItemInstancesTable as typeof sqliteSchema.worldItemInstancesTable;
export const worldSettlementsTable = activeSchema.worldSettlementsTable as typeof sqliteSchema.worldSettlementsTable;
export const userQuestTable = activeSchema.userQuestTable as typeof sqliteSchema.userQuestTable;
export const matchDataTable = activeSchema.matchDataTable as typeof sqliteSchema.matchDataTable;
export const ipLogsTable = activeSchema.ipLogsTable as typeof sqliteSchema.ipLogsTable;
export const bannedIpsTable = activeSchema.bannedIpsTable as typeof sqliteSchema.bannedIpsTable;

export type SessionTableSelect = typeof sessionTable.$inferSelect;
export type UsersTableInsert = typeof usersTable.$inferInsert;
export type UsersTableSelect = typeof usersTable.$inferSelect;
export type UserPassTableSelect = typeof userPassTable.$inferSelect;
export type WalletTransactionsTableSelect = typeof walletTransactionsTable.$inferSelect;
export type WorldShardsTableSelect = typeof worldShardsTable.$inferSelect;
export type WorldLivesTableSelect = typeof worldLivesTable.$inferSelect;
export type WorldItemInstancesTableSelect = typeof worldItemInstancesTable.$inferSelect;
export type WorldSettlementsTableSelect = typeof worldSettlementsTable.$inferSelect;
export type UserQuestTableSelect = typeof userQuestTable.$inferSelect;
export type MatchDataTable = typeof matchDataTable.$inferInsert;
export type IpLogsTable = typeof ipLogsTable.$inferSelect;
