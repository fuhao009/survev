import { defineConfig } from "drizzle-kit";
import { Config } from "../config.ts";

export default defineConfig({
    dialect: "sqlite",
    schema: "src/api/db/schema.sqlite.ts",
    out: "./src/api/db/drizzle-sqlite",
    dbCredentials: {
        url: Config.database.path,
    },
});
