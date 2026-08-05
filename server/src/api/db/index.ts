import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { Config } from "../../config.ts";
import { server } from "../apiServer.ts";
import * as postgresSchema from "./schema.postgres.ts";
import * as sqliteSchema from "./schema.sqlite.ts";

const sqliteDb = (() => {
    if (Config.database.driver !== "sqlite") return undefined;

    fs.mkdirSync(path.dirname(Config.database.path), { recursive: true });
    const sqliteConnection = new Database(Config.database.path);
    sqliteConnection.pragma("foreign_keys = ON");
    sqliteConnection.pragma("journal_mode = WAL");
    sqliteConnection.pragma("synchronous = NORMAL");

    const database = drizzleSqlite({
        client: sqliteConnection,
        schema: sqliteSchema,
    });
    migrateSqlite(database, { migrationsFolder: path.join(import.meta.dirname, "drizzle-sqlite") });
    server.logger.info(`Connected to SQLite database at ${Config.database.path}`);

    // better-sqlite3 requires a synchronous transaction callback, while the
    // existing repository uses async callbacks for PostgreSQL. Keep the same
    // repository contract with an explicit SQLite transaction boundary.
    return new Proxy(database, {
        get(target, property, receiver) {
            if (property !== "transaction") return Reflect.get(target, property, receiver);
            return async (callback: (tx: typeof database) => unknown) => {
                sqliteConnection.exec("BEGIN");
                try {
                    const result = await callback(target);
                    sqliteConnection.exec("COMMIT");
                    return result;
                } catch (error) {
                    sqliteConnection.exec("ROLLBACK");
                    throw error;
                }
            };
        },
    });
})();

const postgresDb = (() => {
    if (Config.database.driver !== "postgres") return undefined;

    const poolConnection = new pg.Pool({
        host: Config.database.host,
        user: Config.database.user,
        password: Config.database.password,
        database: Config.database.database,
        port: Config.database.port,
        idleTimeoutMillis: 60 * 1000,
    });

    poolConnection.on("connect", () => {
        server.logger.info("Connected to PostgreSQL database");
    });
    poolConnection.on("error", (err) => {
        server.logger.error("pg pool error:", err);
    });

    const database = drizzlePostgres({
        client: poolConnection,
        schema: postgresSchema,
    });
    return database;
})();

if (!sqliteDb && !postgresDb) {
    throw new Error(`Unsupported database driver: ${Config.database.driver}`);
}

// Both drivers expose the same query surface and the table objects are selected
// from the matching schema module above.
export const db = (sqliteDb ?? postgresDb)! as NonNullable<typeof sqliteDb>;
