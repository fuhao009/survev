import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { configFileName, getConfig } from "../../config.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const originalSurvevDriver = process.env.SURVEV_DB_DRIVER;
const originalDbDriver = process.env.DB_DRIVER;
const temporaryConfigDirectories: string[] = [];

afterEach(() => {
    if (originalSurvevDriver === undefined) delete process.env.SURVEV_DB_DRIVER;
    else process.env.SURVEV_DB_DRIVER = originalSurvevDriver;

    if (originalDbDriver === undefined) delete process.env.DB_DRIVER;
    else process.env.DB_DRIVER = originalDbDriver;

    for (const directory of temporaryConfigDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function readDriver(options: { localDriver?: string; survevDriver?: string; dbDriver?: string } = {}) {
    const directory = fs.mkdtempSync(path.join(repoRoot, ".tmp-survev-config-"));
    temporaryConfigDirectories.push(directory);

    const localConfig = options.localDriver === undefined
        ? {}
        : { database: { driver: options.localDriver } };
    fs.writeFileSync(path.join(directory, configFileName), JSON.stringify(localConfig));

    if (options.survevDriver === undefined) delete process.env.SURVEV_DB_DRIVER;
    else process.env.SURVEV_DB_DRIVER = options.survevDriver;
    if (options.dbDriver === undefined) delete process.env.DB_DRIVER;
    else process.env.DB_DRIVER = options.dbDriver;

    return getConfig(false, path.relative(repoRoot, directory)).database.driver;
}

describe("database driver configuration boundary", () => {
    test("defaults to SQLite", () => {
        expect(readDriver()).toBe("sqlite");
    });

    test("ignores DB_DRIVER", () => {
        expect(readDriver({ dbDriver: "postgres" })).toBe("sqlite");
    });

    test("does not allow local config to select PostgreSQL", () => {
        expect(readDriver({ localDriver: "postgres" })).toBe("sqlite");
    });

    test("enables PostgreSQL only through SURVEV_DB_DRIVER", () => {
        expect(readDriver({ survevDriver: "postgres" })).toBe("postgres");
        expect(readDriver({ survevDriver: "POSTGRES" })).toBe("postgres");
    });

    test("keeps SQLite when explicitly selected", () => {
        expect(readDriver({ localDriver: "postgres", survevDriver: "sqlite" })).toBe("sqlite");
    });
});
