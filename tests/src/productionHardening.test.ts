import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { stripProductionClientConfig } from "../../client/src/config.ts";
import { configFileName, getConfig } from "../../config.ts";
import { privateApiKeyMatches } from "../../server/src/api/auth/middleware.ts";
import { stripBlockPlugin } from "../../shared/utils/stripBlockPlugin.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const temporaryConfigDirectories: string[] = [];
const productionSecrets = {
    secrets: {
        SURVEV_API_KEY: "test-production-api-key-0000000000000000",
        SURVEV_IP_SECRET: "test-production-ip-secret-000000000000",
    },
};

afterEach(() => {
    for (const directory of temporaryConfigDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function readProductionConfig(localConfig: Record<string, unknown>) {
    const directory = fs.mkdtempSync(path.join(repoRoot, ".tmp-survev-config-"));
    temporaryConfigDirectories.push(directory);

    fs.writeFileSync(
        path.join(directory, configFileName),
        JSON.stringify({ ...productionSecrets, ...localConfig }),
    );
    return getConfig(true, path.relative(repoRoot, directory));
}

async function stripWithPlugin(code: string, id: string, start: string, end: string) {
    const plugin = stripBlockPlugin({
        start,
        end,
    }) as {
        transform: (code: string, id: string) => null | { code: string } | Promise<null | { code: string }>;
    };
    const result = await plugin.transform(code, id);
    return result?.code ?? code;
}

function stripWithProductionClientPlugin(code: string, id: string) {
    return stripWithPlugin(
        code,
        id,
        "STRIP_FROM_PROD_CLIENT:START",
        "STRIP_FROM_PROD_CLIENT:END",
    );
}

function stripWithProductionServerPlugin(code: string, id: string) {
    return stripWithPlugin(
        code,
        id,
        "STRIP_FROM_PROD_SERVER:START",
        "STRIP_FROM_PROD_SERVER:END",
    );
}

describe("production hardening", () => {
    test("requires strong private secrets in production config", () => {
        const directory = fs.mkdtempSync(path.join(repoRoot, ".tmp-survev-config-"));
        temporaryConfigDirectories.push(directory);

        fs.writeFileSync(
            path.join(directory, configFileName),
            JSON.stringify({
                secrets: {
                    SURVEV_API_KEY: "",
                    SURVEV_IP_SECRET: "short",
                },
            }),
        );

        expect(() => getConfig(true, path.relative(repoRoot, directory))).toThrow(
            "SURVEV_API_KEY must be set",
        );
    });

    test("matches private API keys without accepting missing or partial keys", () => {
        const expected = productionSecrets.secrets.SURVEV_API_KEY;

        expect(privateApiKeyMatches(expected, expected)).toBe(true);
        expect(privateApiKeyMatches(undefined, expected)).toBe(false);
        expect(privateApiKeyMatches("", expected)).toBe(false);
        expect(privateApiKeyMatches(expected.slice(0, -1), expected)).toBe(false);
        expect(privateApiKeyMatches(`${expected.slice(0, -1)}x`, expected)).toBe(false);
    });

    test("forces editable debug gates closed in production config", () => {
        const config = readProductionConfig({
            debug: {
                allowBots: true,
                allowEditMsg: true,
                allowMockAccount: true,
                spawnMode: "fixed",
                spawnPos: { x: 10, y: 20 },
            },
        });

        expect(config.debug.allowBots).toBe(false);
        expect(config.debug.allowEditMsg).toBe(false);
        expect(config.debug.allowMockAccount).toBe(false);
        expect(config.debug.spawnMode).toBe("default");
        expect(config.debug.spawnPos).toBeUndefined();
    });

    test("strips client dev-only config keys for production clients", () => {
        const config = {
            playerName: "commercial-player",
            debugTools: { enabled: true, godMode: true },
            debugRenderer: { enabled: true },
            debugHUD: { enabled: true, position: true },
            buildingEditor: { grid: true },
        } as Record<string, unknown>;

        expect(stripProductionClientConfig(config as any)).toBe(true);
        expect(config).toEqual({ playerName: "commercial-player" });
    });

    test("production strip removes TypeScript, HTML, and CSS editable blocks", async () => {
        const ts = await stripWithProductionClientPlugin(
            [
                "const visible = true;",
                "/* STRIP_FROM_PROD_CLIENT:START */",
                "const editableCheat = true;",
                "/* STRIP_FROM_PROD_CLIENT:END */",
            ].join("\n"),
            "/tmp/game.ts",
        );
        const html = await stripWithProductionClientPlugin(
            [
                "<main>",
                "<!-- STRIP_FROM_PROD_CLIENT:START -->",
                "<div id=\"ui-editor\">编辑模式</div>",
                "<!-- STRIP_FROM_PROD_CLIENT:END -->",
                "</main>",
            ].join("\n"),
            "/tmp/index.html",
        );
        const css = await stripWithProductionClientPlugin(
            [
                ".hud { display: block; }",
                "/* STRIP_FROM_PROD_CLIENT:START */",
                "#ui-editor-top-center { display: block; }",
                "/* STRIP_FROM_PROD_CLIENT:END */",
            ].join("\n"),
            "/tmp/game.css?direct",
        );

        expect(ts).toContain("visible");
        expect(ts).not.toContain("editableCheat");
        expect(html).toContain("<main>");
        expect(html).not.toContain("ui-editor");
        expect(html).not.toContain("编辑模式");
        expect(css).toContain(".hud");
        expect(css).not.toContain("ui-editor");
    });

    test("production strip removes server editable message handlers", async () => {
        const server = await stripWithProductionServerPlugin(
            [
                "switch (type) {",
                "/* STRIP_FROM_PROD_SERVER:START */",
                "case net.MsgType.Edit: player.processEditMsg(msg); break;",
                "/* STRIP_FROM_PROD_SERVER:END */",
                "case net.MsgType.Input: player.handleInput(msg); break;",
                "}",
            ].join("\n"),
            "/tmp/client.ts",
        );

        expect(server).toContain("MsgType.Input");
        expect(server).not.toContain("MsgType.Edit");
        expect(server).not.toContain("processEditMsg");
    });
});
