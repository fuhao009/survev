import { expect, test } from "vitest";
import { shouldShowPlayerNameLabel } from "../../shared/utils/playerNameVisibility.ts";

test("own player name label can be hidden only on the local player's view", () => {
    expect(
        shouldShowPlayerNameLabel({
            playerId: 1,
            activePlayerId: 1,
            playerGroupId: 7,
            activeGroupId: 7,
            showOwnPlayerName: true,
        }),
    ).toBe(true);

    expect(
        shouldShowPlayerNameLabel({
            playerId: 1,
            activePlayerId: 1,
            playerGroupId: 7,
            activeGroupId: 7,
            showOwnPlayerName: false,
        }),
    ).toBe(false);

    expect(
        shouldShowPlayerNameLabel({
            playerId: 2,
            activePlayerId: 1,
            playerGroupId: 7,
            activeGroupId: 7,
            showOwnPlayerName: false,
        }),
    ).toBe(true);
});

test("another player's local setting does not hide this player's same-team label", () => {
    expect(
        shouldShowPlayerNameLabel({
            playerId: 1,
            activePlayerId: 2,
            playerGroupId: 7,
            activeGroupId: 7,
            showOwnPlayerName: false,
        }),
    ).toBe(true);
});

test("opponent player name labels stay hidden", () => {
    expect(
        shouldShowPlayerNameLabel({
            playerId: 3,
            activePlayerId: 1,
            playerGroupId: 8,
            activeGroupId: 7,
            showOwnPlayerName: true,
        }),
    ).toBe(false);
});
