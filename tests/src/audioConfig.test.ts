import { beforeEach, describe, expect, test } from "vitest";
import { ConfigManager } from "../../client/src/config.ts";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem(key: string) {
            return storage.get(key) ?? null;
        },
        setItem(key: string, value: string) {
            storage.set(key, value);
        },
    },
});

beforeEach(() => {
    storage.clear();
});

function loadConfig(storedConfig?: object) {
    if (storedConfig) {
        storage.set("surviv_config", JSON.stringify(storedConfig));
    }

    const config = new ConfigManager();
    config.load(() => {});
    return config;
}

describe("audio configuration defaults", () => {
    test("starts muted when no audio preference is stored", () => {
        expect(loadConfig().get("muteAudio")).toBe(true);
    });

    test("preserves a stored unmuted preference", () => {
        expect(loadConfig({ muteAudio: false }).get("muteAudio")).toBe(false);
    });

    test("persists a user opening audio for the next session", () => {
        const config = loadConfig();
        config.set("muteAudio", false);

        expect(loadConfig().get("muteAudio")).toBe(false);
    });
});
