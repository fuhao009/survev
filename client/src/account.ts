import type { ItemInstance } from "../../shared/types/itemInstance.ts";
import type { PassState, ProfileResponse, QuestState } from "../../shared/types/user.ts";
import type { WalletOverviewResponse } from "../../shared/types/wallet.ts";
import type { Item, ItemStatus } from "../../shared/utils/loadout.ts";
import { type Loadout, loadout as loadouts } from "../../shared/utils/loadout.ts";
import { util } from "../../shared/utils/util.ts";
import { api } from "./api.ts";
import type { ConfigManager } from "./config.ts";
import { errorLogManager } from "./errorLogs.ts";
import { helpers } from "./helpers.ts";
import { proxy } from "./proxy.ts";

import { hc } from "hono/client";
import type { UserRouterApp } from "../../server/src/api/routes/user/UserRouter.ts";

type UserRouter = ReturnType<typeof hc<UserRouterApp>>;
type UserRouterPostPath = {
    [Path in keyof UserRouter]: UserRouter[Path] extends {
        $post: (...args: any[]) => any;
    } ? Path
        : never;
}[keyof UserRouter];
type UserRouterPost<Path extends UserRouterPostPath> = Extract<
    UserRouter[Path],
    { $post: (...args: any[]) => any }
>["$post"];

type AccountEventMap = {
    request: (account: Account) => void;
    requestsComplete: () => void;
    login: (account: Account) => void;
    loadout: (loadout: Loadout) => void;
    items: (items: Item[]) => void;
    error: (error: string, reason?: string) => void;
    pass: (pass: PassState, quests: QuestState[], resetRefresh: boolean) => void;
    wallet: (walletBalance: number) => void;
    worldInventory: (items: ItemInstance[]) => void;
};

export class Account {
    events: Record<string, Array<(...args: any[]) => void>> = {};
    requestsInFlight = 0;
    loggingIn = false;
    loggedIn = false;
    profile = {
        linked: false,
        usernameSet: false,
        username: "",
        slug: "",
        usernameChangeTime: 0,
    };

    loadout = loadouts.defaultLoadout();
    items: Item[] = [];
    quests: QuestState[] = [];
    pass = {} as PassState;
    walletBalance = 0;
    worldInventory: ItemInstance[] = [];

    router: UserRouter;

    constructor(public config: ConfigManager) {
        this.router = hc<UserRouterApp>(api.resolveUrl("/api/user"), {
            init: {
                credentials: "include",
            },
        });
    }

    async fetchApi<Path extends UserRouterPostPath>(
        path: Path,
        body: Parameters<UserRouterPost<Path>>[0],
        cb: (
            error: null | any,
            res: Awaited<ReturnType<Awaited<ReturnType<UserRouterPost<Path>>>["json"]>>,
        ) => void,
    ): Promise<void> {
        this.requestsInFlight++;
        this.emit("request", this);

        try {
            const routerPath = this.router[path] as Extract<
                UserRouter[Path],
                { $post: (...args: any[]) => any }
            >;
            const res = await routerPath.$post(body as any);
            const data = await res.json();
            cb(null, data as any);
        } catch (err) {
            cb(err, {} as any);
        }

        this.requestsInFlight--;
        this.emit("request", this);
        if (this.requestsInFlight == 0) {
            this.emit("requestsComplete");
        }
    }

    addEventListener<E extends keyof AccountEventMap>(
        event: E,
        callback: AccountEventMap[E],
    ) {
        this.events[event] = this.events[event] || [];
        this.events[event].push(callback);
    }

    removeEventListener<E extends keyof AccountEventMap>(
        event: E,
        callback: AccountEventMap[E],
    ) {
        const listeners = this.events[event] || [];
        for (let i = listeners.length - 1; i >= 0; i--) {
            if (listeners[i] == callback) {
                listeners.splice(i, 1);
            }
        }
    }

    emit<E extends keyof AccountEventMap>(event: E, ...args: Parameters<AccountEventMap[E]>): void {
        const listenersCopy = (this.events[event] || []).slice(0);
        for (let i = 0; i < listenersCopy.length; i++) {
            listenersCopy[i](...args);
        }
    }

    init() {
        if (this.config.get("sessionCookie")) {
            this.setSessionCookies();
        }

        if (helpers.getCookie("app-data")) {
            this.login();
            return;
        }

        this.emit("request", this);
        this.emit("items", []);

        const storedLoadout = this.config.get("loadout");
        this.loadout = util.mergeDeep({}, loadouts.defaultLoadout(), storedLoadout);
        this.emit("loadout", this.loadout);
    }

    setSessionCookies() {
        this.clearSessionCookies();
        document.cookie = this.config.get("sessionCookie")!;
        document.cookie = `app-data=${Date.now()}`;
    }

    clearSessionCookies() {
        document.cookie = "app-sid=;expires=Thu, 01 Jan 1970 00:00:01 GMT;";
        document.cookie = "app-data=;expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    }

    login() {
        if (helpers.getCookie("app-data")) {
            this.loadProfile();
            this.getPass(true);
        }
    }

    private resetWallet() {
        this.walletBalance = 0;
        this.emit("wallet", this.walletBalance);
    }

    private async requestWalletBalance(): Promise<number> {
        const res = await this.router.wallet.$get();
        if (!res.ok) {
            throw new Error(`wallet request failed: ${res.status}`);
        }
        const data = await res.json() as WalletOverviewResponse;
        if (!Number.isFinite(data.balance)) {
            throw new Error("wallet response has an invalid balance");
        }
        return data.balance;
    }

    async loadWallet(): Promise<boolean> {
        if (!this.loggedIn || !helpers.getCookie("app-data")) {
            this.resetWallet();
            return false;
        }

        this.requestsInFlight++;
        this.emit("request", this);
        try {
            const balance = await this.requestWalletBalance();
            if (!this.loggedIn) {
                this.resetWallet();
                return false;
            }
            this.walletBalance = balance;
            this.emit("wallet", this.walletBalance);
            return true;
        } catch (_error) {
            // Keep the last known value so a transient refresh failure cannot
            // make the account center display false zero balances.
            errorLogManager.storeGeneric("account", "load_wallet_error");
            return false;
        } finally {
            this.requestsInFlight--;
            this.emit("request", this);
            if (this.requestsInFlight == 0) {
                this.emit("requestsComplete");
            }
        }
    }

    /** Refresh the account hub from profile, world-inventory, and wallet authorities. */
    async refreshAccountData(): Promise<boolean> {
        if (!this.loggedIn || !helpers.getCookie("app-data")) {
            return false;
        }

        this.requestsInFlight++;
        this.emit("request", this);
        try {
            const [res, walletBalance] = await Promise.all([
                this.router.profile.$post({}),
                this.requestWalletBalance(),
            ]);
            if (!res.ok) {
                throw new Error(`profile refresh failed: ${res.status}`);
            }
            const data = await res.json() as ProfileResponse;
            if (!data.success || !Array.isArray(data.worldInventory)) {
                this.emit("error", "server_error");
                return false;
            }

            if (!this.loggedIn) {
                return false;
            }

            this.profile = data.profile;
            this.items = data.items;
            this.worldInventory = data.worldInventory;
            this.loadout = data.loadout;
            this.walletBalance = walletBalance;
            const profile = this.config.get("profile") || { slug: "" };
            profile.slug = data.profile.slug;
            this.config.set("profile", profile);
            this.emit("items", this.items);
            this.emit("worldInventory", this.worldInventory);
            this.emit("loadout", this.loadout);
            this.emit("wallet", this.walletBalance);
            return true;
        } catch (_error) {
            // Do not clear the existing profile, inventory, or wallet. The
            // account center remains usable and its retry action can recover.
            errorLogManager.storeGeneric("account", "refresh_profile_error");
            return false;
        } finally {
            this.requestsInFlight--;
            this.emit("request", this);
            if (this.requestsInFlight == 0) {
                this.emit("requestsComplete");
            }
        }
    }

    logout() {
        this.loggedIn = false;
        this.resetWallet();
        this.worldInventory = [];
        this.emit("worldInventory", this.worldInventory);
        this.config.set("profile", null);
        this.config.set("sessionCookie", null);
        this.config.set("loadout", loadouts.defaultLoadout());
        this.fetchApi("logout", {}, () => {
            window.location.reload();
        });
    }

    loadProfile() {
        this.loggingIn = !this.loggedIn;
        this.fetchApi("profile", {}, (err, data) => {
            const wasLogginIn = this.loggingIn;
            this.loggingIn = false;
            this.loggedIn = false;
            this.profile = {} as this["profile"];
            this.items = [];
            this.worldInventory = [];
            this.resetWallet();
            if (err) {
                errorLogManager.storeGeneric("account", "load_profile_error");
            } else if (data.banned) {
                this.emit("error", "account_banned", data.reason);
            } else if (data.success) {
                this.loggedIn = true;
                this.profile = data.profile;
                this.items = data.items;
                this.worldInventory = data.worldInventory;
                this.loadout = data.loadout;
                const profile = this.config.get("profile") || { slug: "" };
                profile.slug = data.profile.slug;
                this.config.set("profile", profile);
            }
            if (!this.loggedIn) {
                this.config.set("sessionCookie", null);
            }
            if (this.loggedIn) {
                this.loadWallet();
            }
            if (wasLogginIn && this.loggedIn) {
                this.emit("login", this);
            }
            this.emit("items", this.items);
            this.emit("worldInventory", this.worldInventory);
            this.emit("loadout", this.loadout);
        });
    }

    resetStats() {
        this.fetchApi("reset_stats", {}, (err) => {
            if (err) {
                errorLogManager.storeGeneric("account", "reset_stats_error");
                this.emit("error", "server_error");
            }
        });
    }

    deleteAccount() {
        this.fetchApi("delete", {}, (err) => {
            if (err) {
                errorLogManager.storeGeneric("account", "delete_error");
                this.emit("error", "server_error");
                return;
            }
            this.config.set("profile", null);
            this.config.set("sessionCookie", null);
            window.location.reload();
        });
    }

    setUsername(username: string, callback: (err?: string) => void) {
        this.fetchApi("username", { json: { username } }, (err, res) => {
            if (err) {
                errorLogManager.storeGeneric("account", "set_username_error");
                callback(err);
                return;
            }
            if (res.result == "success") {
                this.loadProfile();
                callback();
            } else {
                callback(res.result);
            }
        });
    }

    setLoadout(loadout: Loadout) {
        // Preemptively set the new loadout and revert if the call fail
        const loadoutPrev = this.loadout;
        this.loadout = loadout;
        this.emit("loadout", this.loadout);
        this.config.set("loadout", loadout);

        if (!helpers.getCookie("app-data")) return;

        this.fetchApi("loadout", { json: { loadout } }, (err, res) => {
            if (err) {
                errorLogManager.storeGeneric("account", "set_loadout_error");
                this.emit("error", "server_error");
            }
            if (err || !res.loadout) {
                this.loadout = loadoutPrev;
            } else {
                this.loadout = res.loadout;
            }
            this.emit("loadout", this.loadout);
        });
    }

    setItemStatus(status: ItemStatus, itemTypes: string[]) {
        if (itemTypes.length != 0) {
            // Preemptively mark the item status as modified on our local copy
            for (let i = 0; i < itemTypes.length; i++) {
                const item = this.items.find((x) => {
                    return x.type == itemTypes[i];
                });
                if (item) {
                    item.status = Math.max(item.status!, status);
                }
            }

            this.emit("items", this.items);
            this.fetchApi("set_item_status", {
                json: {
                    status,
                    itemTypes,
                },
            }, (err) => {
                if (err) {
                    errorLogManager.storeGeneric("account", "set_item_status_error");
                }
            });
        }
    }

    getPass(tryRefreshQuests: boolean) {
        this.fetchApi("get_pass", { json: { tryRefreshQuests } }, (err, res) => {
            this.pass = {} as PassState;
            this.quests = [];
            if (err || !res.success) {
                errorLogManager.storeGeneric("account", "get_pass_error");
            } else {
                this.pass = res.pass || {} as PassState;
                this.quests = res.quests || [];
                this.quests.sort((a, b) => {
                    return a.idx - b.idx;
                });
                this.emit("pass", this.pass, this.quests, true);
                if (this.pass?.newItems) {
                    this.loadProfile();
                }
            }
        });
    }

    setPassUnlock(unlockType: string) {
        this.fetchApi("set_pass_unlock", { json: { unlockType } }, (err, res) => {
            if (err || !res.success) {
                errorLogManager.storeGeneric("account", "set_pass_unlock_error");
            } else {
                this.getPass(false);
            }
        });
    }

    refreshQuest(idx: number) {
        this.fetchApi("refresh_quest", { json: { idx } }, (err, res) => {
            if (err) {
                errorLogManager.storeGeneric("account", "refresh_quest_error");
                return;
            }
            if (res.success) {
                this.getPass(false);
            } else {
                // Give the pass UI a chance to update quests
                this.emit("pass", this.pass!, this.quests, false);
            }
        });
    }
}
