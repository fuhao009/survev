import { defineConfig } from "drizzle-kit";
import { Config } from "../config.ts";

export default defineConfig({
    dialect: "postgresql",
    schema: "src/api/db/schema.postgres.ts",
    out: "./src/api/db/drizzle",
    dbCredentials: {
        host: Config.database.host,
        user: Config.database.user,
        password: Config.database.password,
        database: Config.database.database,
        port: Config.database.port,
        ssl: false,
    },
});
