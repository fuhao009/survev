import { describe, expect, test } from "vitest";
import {
    getWorldLightning,
    WORLD_LIGHTNING_DURATION_MS,
    type WorldLightning,
} from "../../shared/types/worldLightning.ts";

describe("authoritative world lightning schedule", () => {
    const seed = "gun-world-lightning-seed";
    const thunderstorm = {
        type: "thunderstorm" as const,
        revision: 4,
        startedAt: 1_700_000_000_000,
        endsAt: 1_700_000_630_000,
    };

    test("does not schedule lightning outside a thunderstorm", () => {
        const clear = getWorldLightning(seed, { ...thunderstorm, type: "clear" }, thunderstorm.startedAt);

        expect(clear).toEqual<WorldLightning>({
            kind: "world_lightning",
            revision: thunderstorm.revision,
            weatherRevision: thunderstorm.revision,
            events: [],
        });
    });

    test("is deterministic and keeps event positions inside the map", () => {
        const first = getWorldLightning(seed, thunderstorm, thunderstorm.startedAt + 20_000);
        const second = getWorldLightning(seed, thunderstorm, thunderstorm.startedAt + 20_000);

        expect(first).toEqual(second);
        expect(first.events.length).toBeGreaterThan(0);
        for (const event of first.events) {
            expect(event.weatherRevision).toBe(thunderstorm.revision);
            expect(event.expiresAt).toBe(event.strikeAt + WORLD_LIGHTNING_DURATION_MS);
            expect(event.position.x).toBeGreaterThanOrEqual(0);
            expect(event.position.y).toBeGreaterThanOrEqual(0);
            expect(event.position.x).toBeLessThanOrEqual(4096);
            expect(event.position.y).toBeLessThanOrEqual(4096);
        }
    });

    test("transitions an event from scheduled to active and removes it after expiry", () => {
        const initial = getWorldLightning(seed, thunderstorm, thunderstorm.startedAt);
        const first = initial.events[0];
        expect(first).toBeDefined();

        const scheduled = getWorldLightning(seed, thunderstorm, first!.strikeAt - 1).events[0];
        const active = getWorldLightning(seed, thunderstorm, first!.strikeAt).events[0];
        const afterExpiry = getWorldLightning(seed, thunderstorm, first!.expiresAt).events[0];

        expect(scheduled?.eventId).toBe(first!.eventId);
        expect(scheduled?.phase).toBe("scheduled");
        expect(active?.eventId).toBe(first!.eventId);
        expect(active?.phase).toBe("active");
        expect(afterExpiry?.eventId).not.toBe(first!.eventId);
    });
});
