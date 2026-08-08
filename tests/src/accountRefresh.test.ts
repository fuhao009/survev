import { describe, expect, test, vi } from "vitest";
import type { ItemInstance } from "../../shared/types/itemInstance.ts";
import type { ProfileResponse } from "../../shared/types/user.ts";
import type { Loadout } from "../../shared/utils/loadout.ts";

Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
        cookie: "app-data=session",
        createElement: () => ({
            getContext: () => ({
                drawImage() {},
                fillRect() {},
                getImageData: () => ({ data: [0, 0, 0, 0] }),
            }),
        }),
    },
});
Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
        devicePixelRatio: 1,
        innerHeight: 768,
        innerWidth: 1024,
        location: { hostname: "localhost" },
        navigator: { userAgent: "node" },
        orientation: 0,
    },
});
Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "node" },
});
Object.defineProperty(globalThis, "screen", {
    configurable: true,
    value: { height: 768, width: 1024 },
});

const { Account } = await import("../../client/src/account.ts");

function item(durability: number, state: ItemInstance["state"] = "stash"): ItemInstance {
    return {
        instanceId: "ak47-1",
        type: "ak47",
        quantity: 1,
        durability,
        durabilityMax: 1000,
        state,
        ownerId: "player-1",
    };
}

function profileResponse(worldInventory: ItemInstance[]): ProfileResponse {
    return {
        success: true,
        profile: {
            slug: "player-1",
            username: "Player",
            nickname: "Player",
            usernameSet: true,
            linked: false,
            usernameChangeTime: 0,
        },
        loadout: {} as Loadout,
        items: [],
        worldInventory,
    };
}

function response<T>(data: T, ok = true) {
    return {
        ok,
        status: ok ? 200 : 503,
        json: async () => data,
    };
}

function createAccount() {
    const account = Object.create(Account.prototype) as InstanceType<typeof Account>;
    account.events = {};
    account.requestsInFlight = 0;
    account.loggedIn = true;
    account.walletBalance = 46;
    account.worldInventory = [item(700)];
    account.profile = {
        linked: false,
        nickname: "Old Player",
        usernameSet: true,
        username: "Old Player",
        slug: "old-player",
        usernameChangeTime: 0,
    };
    account.items = [];
    const configState = {
        profile: { slug: "old-player", username: "Old Player", nickname: "Old Player" },
        playerName: "",
    };
    account.router = {
        profile: { $post: vi.fn() },
        wallet: { $get: vi.fn() },
    } as unknown as typeof account.router;
    account.config = {
        get: vi.fn((key: string) => {
            if (key === "profile") return configState.profile;
            if (key === "playerName") return configState.playerName;
            return undefined;
        }),
        set: vi.fn((key: string, value: unknown) => {
            if (key === "profile") {
                configState.profile = value as typeof configState.profile;
            }
            if (key === "playerName") {
                configState.playerName = value as string;
            }
        }),
    } as unknown as typeof account.config;
    return account;
}

describe("account center refresh contract", () => {
    test("refreshes wallet and warehouse durability after extraction", async () => {
        const account = createAccount();
        account.router.profile.$post = vi.fn().mockResolvedValue(response(profileResponse([item(742)])));
        account.router.wallet.$get = vi.fn().mockResolvedValue(response({ balance: 81 }));

        await expect(account.refreshAccountData()).resolves.toBe(true);

        expect(account.walletBalance).toBe(81);
        expect(account.worldInventory).toEqual([item(742)]);
        expect(account.router.profile.$post).toHaveBeenCalledOnce();
        expect(account.router.wallet.$get).toHaveBeenCalledOnce();
    });

    test("keeps old data on refresh failure and succeeds on retry", async () => {
        const account = createAccount();
        const profile = vi.fn()
            .mockRejectedValueOnce(new Error("temporary profile failure"))
            .mockResolvedValueOnce(response(profileResponse([item(1000, "equipped")])));
        account.router.profile.$post = profile;
        account.router.wallet.$get = vi.fn()
            .mockResolvedValueOnce(response({ balance: 46 }))
            .mockResolvedValueOnce(response({ balance: 81 }));

        await expect(account.refreshAccountData()).resolves.toBe(false);
        expect(account.walletBalance).toBe(46);
        expect(account.worldInventory).toEqual([item(700)]);

        await expect(account.refreshAccountData()).resolves.toBe(true);
        expect(account.walletBalance).toBe(81);
        expect(account.worldInventory).toEqual([item(1000, "equipped")]);
        expect(account.requestsInFlight).toBe(0);
    });

    test("keeps the complete previous snapshot when only the wallet fails", async () => {
        const account = createAccount();
        account.router.profile.$post = vi.fn().mockResolvedValue(response(profileResponse([item(742)])));
        account.router.wallet.$get = vi.fn().mockRejectedValue(new Error("temporary wallet failure"));

        await expect(account.refreshAccountData()).resolves.toBe(false);

        expect(account.walletBalance).toBe(46);
        expect(account.worldInventory).toEqual([item(700)]);
    });

    test("syncs the local player name from the account nickname on refresh", async () => {
        const account = createAccount();
        account.router.profile.$post = vi.fn().mockResolvedValue(response(profileResponse([item(742)])));
        account.router.wallet.$get = vi.fn().mockResolvedValue(response({ balance: 81 }));

        await expect(account.refreshAccountData()).resolves.toBe(true);

        expect(account.config.set).toHaveBeenCalledWith("playerName", "Player");
    });
});
