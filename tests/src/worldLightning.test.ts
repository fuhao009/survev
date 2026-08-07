import { describe, expect, test } from "vitest";
import {
    getWorldLightning,
    getWorldLightningImpact,
    shouldApplyWorldLightningEvent,
    WORLD_LIGHTNING_DURATION_MS,
    type WorldLightning,
} from "../../shared/types/worldLightning.ts";
import {
    getWorldTerrainLightningModifier,
    type WorldTerrainPatch,
    type WorldTerrainPatchType,
} from "../../shared/types/worldTerrain.ts";

function terrainPatch(
    id: string,
    type: WorldTerrainPatchType,
    bounds: WorldTerrainPatch["bounds"],
    revision = 1,
): WorldTerrainPatch {
    return {
        kind: "world_terrain_patch",
        id,
        type,
        bounds,
        intensity: 1,
        revision,
        updatedAt: 1_700_000_000_000,
        expiresAt: 1_700_000_300_000,
    };
}

describe("authoritative world lightning schedule", () => {
    const seed = "gun-world-lightning-seed";
    const thunderstorm = {
        type: "thunderstorm" as const,
        phase: "stable" as const,
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

    test("does not strike during the thunderstorm warning phase", () => {
        const warning = getWorldLightning(
            seed,
            { ...thunderstorm, phase: "warning" },
            thunderstorm.startedAt + 20_000,
        );

        expect(warning.events).toEqual([]);
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
        expect(new Set(first.events.map((event) => event.revision)).size).toBe(first.events.length);
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

    test("applies conductive flooded terrain to radius and damage", () => {
        const event = {
            revision: 7,
            position: { x: 100, y: 100 },
            radius: 100,
            damage: 24,
        } as const;
        const playerPosition = { x: 260, y: 100 };
        const terrain = {
            revision: 3,
            patches: [
                terrainPatch(
                    "flooded-a",
                    "flooded",
                    { min: { x: 200, y: 50 }, max: { x: 300, y: 150 } },
                    3,
                ),
            ],
        };

        expect(getWorldLightningImpact(event, playerPosition)).toBeNull();
        const impact = getWorldLightningImpact(
            event,
            playerPosition,
            getWorldTerrainLightningModifier(playerPosition, terrain),
        );

        expect(impact).toMatchObject({
            eventRevision: 7,
            radius: 175,
        });
        expect(impact?.damage).toBeCloseTo(32.4);
    });

    test("uses a stable strongest rule for overlapping terrain patches", () => {
        const terrain = {
            revision: 8,
            patches: [
                terrainPatch("mud", "mud", { min: { x: 0, y: 0 }, max: { x: 20, y: 20 } }, 8),
                terrainPatch("flooded", "flooded", { min: { x: 10, y: 10 }, max: { x: 30, y: 30 } }, 8),
            ],
        };
        const position = { x: 15, y: 15 };
        const first = getWorldTerrainLightningModifier(position, terrain);
        const second = getWorldTerrainLightningModifier(position, {
            ...terrain,
            patches: [...terrain.patches].reverse(),
        });

        expect(first).toEqual(second);
        expect(first.matchedPatches.map((patch) => patch.id)).toEqual(["flooded", "mud"]);
        expect(first.radiusMultiplier).toBe(1.75);
        expect(first.damageMultiplier).toBe(1.35);
    });

    test("has no impact outside the radius by default", () => {
        const event = {
            revision: 1,
            position: { x: 0, y: 0 },
            radius: 20,
            damage: 24,
        } as const;

        expect(getWorldLightningImpact(event, { x: 20, y: 0 })?.damage).toBe(24);
        expect(getWorldLightningImpact(event, { x: 20.001, y: 0 })).toBeNull();
    });

    test("allows one damage application per event revision across its active window", () => {
        expect(shouldApplyWorldLightningEvent(undefined, 11)).toBe(true);
        expect(shouldApplyWorldLightningEvent(10, 11)).toBe(true);
        expect(shouldApplyWorldLightningEvent(11, 11)).toBe(false);
    });
});
