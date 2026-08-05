import Database from "better-sqlite3";
import fs from "node:fs";
import pg from "pg";
import { Config } from "../../config.ts";

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
        user: "postgres",
        password: "postgres",
        database: "postgres",
        port: Config.database.port,
    });

    try {
        await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'survev'`);
        await pool.query(`DROP DATABASE IF EXISTS survev`);
        await pool.query(`CREATE DATABASE survev OWNER survev`);
        console.log("PostgreSQL database wiped successfully");
    } catch (error) {
        console.error("Error dropping database:", error);
    } finally {
        await pool.end();
    }
}
