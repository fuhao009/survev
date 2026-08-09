import Database from "better-sqlite3";
import fs from "node:fs";
import pg from "pg";
import { Config } from "../../config.ts";

const confirmationValue = "WIPE_SURVEV_DATABASE";

function quoteIdent(value: string) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
}

function requireWipeConfirmation() {
    if (process.env.NODE_ENV === "production") {
        throw new Error("Refusing to wipe database while NODE_ENV=production");
    }

    if (process.env.SURVEV_CONFIRM_DB_WIPE !== confirmationValue) {
        throw new Error(
            `Refusing to wipe database; set SURVEV_CONFIRM_DB_WIPE=${confirmationValue} to confirm`,
        );
    }
}

requireWipeConfirmation();

if (Config.database.driver === "sqlite") {
    const sqlite = new Database(Config.database.path);
    sqlite.close();
    for (const suffix of ["", "-wal", "-shm"]) {
        const file = `${Config.database.path}${suffix}`;
        if (fs.existsSync(file)) fs.rmSync(file);
    }
    console.log(`SQLite database wiped: ${Config.database.path}`);
} else {
    const pool = new pg.Pool({
        host: Config.database.host,
        user: process.env.SURVEV_DB_WIPE_USER ?? "postgres",
        password: process.env.SURVEV_DB_WIPE_PASSWORD ?? "postgres",
        database: process.env.SURVEV_DB_WIPE_DATABASE ?? "postgres",
        port: Config.database.port,
    });

    try {
        await pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [
            Config.database.database,
        ]);
        await pool.query(`DROP DATABASE IF EXISTS ${quoteIdent(Config.database.database)}`);
        await pool.query(
            `CREATE DATABASE ${quoteIdent(Config.database.database)} OWNER ${quoteIdent(Config.database.user)}`,
        );
        console.log(`PostgreSQL database wiped successfully: ${Config.database.database}`);
    } catch (error) {
        console.error("Error dropping database:", error);
    } finally {
        await pool.end();
    }
}
