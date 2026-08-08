import $ from "jquery";
import loadout, { type Item } from "../../../shared/utils/loadout.ts";
import type { Account } from "../account.ts";
import { api } from "../api.ts";
import { device } from "../device.ts";
import { helpers } from "../helpers.ts";
import { proxy } from "../proxy.ts";
import { SDK } from "../sdk/sdk.ts";
import { getWorldItemLabel, getWorldItemStateLabel } from "../worldSettlement.ts";
import type { LoadoutMenu } from "./loadoutMenu.ts";
import type { Localization } from "./localization.ts";
import { MenuModal } from "./menuModal.ts";
import { isUserCenterHash, resolveUserCenterReturnHash } from "./userCenterNavigation.ts";

function createLoginOptions(
    parentElem: JQuery<HTMLElement>,
    linkAccount: boolean | undefined,
    account: Account,
    localization: Localization,
) {
    const contentsElem = parentElem.find(".login-options-content");
    contentsElem.empty();
    if (linkAccount) {
        contentsElem.append(
            $("<div/>", {
                class: "account-login-desc",
            }).append(
                $("<p/>", {
                    html: localization.translate("index-link-account-to"),
                }),
            ),
        );
    }
    const form = $("<form/>", { class: "account-auth-form" });
    const modeRow = $("<div/>", { class: "account-auth-mode" });
    const loginMode = $("<button/>", {
        type: "button",
        class: "menu-option btn-hollow btn-hollow-selected account-auth-mode-button",
        text: localization.translate("index-account-login"),
    });
    const registerMode = $("<button/>", {
        type: "button",
        class: "menu-option btn-hollow account-auth-mode-button",
        text: localization.translate("index-account-register"),
    });
    const usernameInput = $("<input/>", {
        type: "text",
        class: "menu-option account-auth-input",
        autocomplete: "username",
        placeholder: localization.translate("index-account-username-placeholder"),
        "aria-label": localization.translate("index-account-username"),
        minlength: 3,
        maxlength: 24,
        required: true,
    });
    const passwordInput = $("<input/>", {
        type: "password",
        class: "menu-option account-auth-input",
        autocomplete: "current-password",
        placeholder: localization.translate("index-account-password-placeholder"),
        "aria-label": localization.translate("index-account-password"),
        minlength: 8,
        maxlength: 128,
        required: true,
    });
    const submitButton = $("<button/>", {
        type: "submit",
        class: "menu-option btn-green btn-darken account-auth-submit",
        text: localization.translate("index-account-login"),
    });
    const errorMessage = $("<div/>", { class: "account-auth-error" });

    modeRow.append(loginMode, registerMode);
    form.append(modeRow, usernameInput, passwordInput, submitButton, errorMessage);
    contentsElem.append(form);

    let mode: "login" | "register" = "login";
    const setMode = (nextMode: "login" | "register") => {
        mode = nextMode;
        loginMode.toggleClass("btn-hollow-selected", mode === "login");
        registerMode.toggleClass("btn-hollow-selected", mode === "register");
        submitButton.text(
            localization.translate(mode === "login" ? "index-account-login" : "index-account-register"),
        );
        passwordInput.attr(
            "autocomplete",
            mode === "login" ? "current-password" : "new-password",
        );
        errorMessage.empty();
    };

    loginMode.on("click", () => setMode("login"));
    registerMode.on("click", () => setMode("register"));
    form.on("submit", async (event) => {
        event.preventDefault();
        const username = String(usernameInput.val() ?? "").trim();
        const password = String(passwordInput.val() ?? "");
        if (mode === "register") {
            if (username.length < 3 || !/^[\p{L}\p{N}_.-]+$/u.test(username)) {
                errorMessage.text(localization.translate("index-account-username-invalid"));
                return;
            }
            if (password.length < 8) {
                errorMessage.text(localization.translate("index-account-password-invalid"));
                return;
            }
        }
        submitButton.prop("disabled", true);
        errorMessage.empty();
        try {
            const response = await fetch(api.resolveUrl("/api/auth/local"), {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mode,
                    username,
                    password,
                }),
            });
            const data = await response.json() as { result?: string };
            if (response.ok && data.result === "success") {
                window.location.reload();
                return;
            }
            const errorKey = data.result === "username_taken"
                ? "index-account-username-taken"
                : mode === "login"
                ? "index-account-login-failed"
                : "index-account-invalid";
            errorMessage.text(localization.translate(errorKey));
        } catch (_error) {
            errorMessage.text(localization.translate("index-account-network-error"));
        } finally {
            submitButton.prop("disabled", false);
        }
    });
}

export class ProfileUi {
    setNameModal: MenuModal | null = null;
    setNicknameModal: MenuModal | null = null;
    resetStatsModal: MenuModal | null = null;
    deleteAccountModal: MenuModal | null = null;
    userSettingsModal: MenuModal | null = null;
    loginOptionsModal: MenuModal | null = null;
    createAccountModal: MenuModal | null = null;
    userCenterModal: MenuModal | null = null;

    loginOptionsModalMobile!: MenuModal;
    modalMobileAccount!: MenuModal;

    constructor(
        public account: Account,
        public localization: Localization,
        public loadoutMenu: LoadoutMenu,
        public errorModal: MenuModal,
    ) {
        account.addEventListener("error", this.onError.bind(this));
        account.addEventListener("login", this.onLogin.bind(this));
        account.addEventListener("loadout", this.onLoadoutUpdated.bind(this));
        account.addEventListener("items", this.onItemsUpdated.bind(this));
        account.addEventListener("wallet", this.onWalletUpdated.bind(this));
        account.addEventListener("worldInventory", this.onWorldInventoryUpdated.bind(this));
        account.addEventListener("request", this.render.bind(this));
        this.initUi();
        this.render();
    }

    initUi() {
        // Set username
        const clearNamePrompt = function() {
            $("#modal-body-warning").css("display", "none");
            $("#modal-account-name-input").val("");
        };
        this.setNameModal = new MenuModal($("#modal-account-name-change"));
        this.setNameModal.onShow(clearNamePrompt);
        this.setNameModal.onHide(clearNamePrompt);
        $("#modal-account-name-finish").on("click", (t) => {
            t.stopPropagation();
            const name = $("#modal-account-name-input").val() as string;
            this.account.setUsername(name, (error?: string) => {
                if (error) {
                    const ERROR_CODE_TO_LOCALIZATION = {
                        failed: "设置用户名失败。",
                        invalid: "用户名无效。",
                        taken: "用户名已被使用！",
                        change_time_not_expired: "用户名最近已设置过。",
                    };
                    const message = ERROR_CODE_TO_LOCALIZATION[
                        error as keyof typeof ERROR_CODE_TO_LOCALIZATION
                    ] || ERROR_CODE_TO_LOCALIZATION.failed;
                    $("#modal-body-warning").hide();
                    $("#modal-body-warning").html(message);
                    $("#modal-body-warning").fadeIn();
                } else {
                    this.setNameModal!.hide();
                }
            });
        });
        $("#modal-account-name-input").on("keypress", (e) => {
            if (e.key === "Enter") {
                $("#modal-account-name-finish").trigger("click");
            }
        });

        const clearNicknamePrompt = function() {
            $("#modal-body-warning-nickname").css("display", "none");
            $("#modal-account-nickname-input").val("");
        };
        this.setNicknameModal = new MenuModal($("#modal-account-nickname-change"));
        this.setNicknameModal.onShow(clearNicknamePrompt);
        this.setNicknameModal.onHide(clearNicknamePrompt);
        $("#modal-account-nickname-finish").on("click", (t) => {
            t.stopPropagation();
            const nickname = $("#modal-account-nickname-input").val() as string;
            this.account.setNickname(nickname, (error?: string) => {
                if (error) {
                    const ERROR_CODE_TO_LOCALIZATION = {
                        failed: "设置昵称失败。",
                        invalid: "昵称无效。",
                    };
                    const message = ERROR_CODE_TO_LOCALIZATION[
                        error as keyof typeof ERROR_CODE_TO_LOCALIZATION
                    ] || ERROR_CODE_TO_LOCALIZATION.failed;
                    $("#modal-body-warning-nickname").hide();
                    $("#modal-body-warning-nickname").html(message);
                    $("#modal-body-warning-nickname").fadeIn();
                } else {
                    this.setNicknameModal!.hide();
                }
            });
        });
        $("#modal-account-nickname-input").on("keypress", (e) => {
            if (e.key === "Enter") {
                $("#modal-account-nickname-finish").trigger("click");
            }
        });

        // Reset stats
        this.resetStatsModal = new MenuModal($("#modal-account-reset-stats"));
        this.resetStatsModal.onShow(() => {
            $("#modal-account-reset-stats-input").val("");
            this.modalMobileAccount.hide();
        });
        $("#modal-account-reset-stats-finish").on("click", (t) => {
            t.stopPropagation();
            if (
                String($("#modal-account-reset-stats-input").val() ?? "")
                    === this.localization.translate("index-reset-stats-confirmation")
            ) {
                this.account.resetStats();
                this.resetStatsModal!.hide();
            }
        });
        $("#modal-account-reset-stats-input").on("keypress", (e) => {
            if (e.key === "Enter") {
                $("#modal-account-reset-stats-finish").trigger("click");
            }
        });
        // Delete account
        this.deleteAccountModal = new MenuModal($("#modal-account-delete"));
        this.deleteAccountModal.onShow(() => {
            $("#modal-account-delete-input").val("");
            this.modalMobileAccount.hide();
        });
        $("#modal-account-delete-finish").on("click", (t) => {
            t.stopPropagation();
            if (
                String($("#modal-account-delete-input").val() ?? "")
                    === this.localization.translate("index-delete-account-confirmation")
            ) {
                this.account.deleteAccount();
                this.deleteAccountModal!.hide();
            }
        });
        $("#modal-account-delete-input").on("keypress", (e) => {
            if (e.key === "Enter") {
                $("#modal-account-delete-finish").trigger("click");
            }
        });

        // User settings
        this.userSettingsModal = new MenuModal($(".account-buttons-settings"));
        this.userSettingsModal.checkSelector = false;
        this.userSettingsModal.skipFade = true;
        this.userSettingsModal.onShow(() => {
            $(".account-details-top").css("display", "none");
        });
        this.userSettingsModal.onHide(() => {
            $(".account-details-top").css("display", "block");
        });

        // Login and link options
        this.loginOptionsModal = new MenuModal($("#account-login-options"));
        this.loginOptionsModal.checkSelector = false;
        this.loginOptionsModal.skipFade = true;
        this.loginOptionsModal.onShow(() => {
            $(".account-details-top").css("display", "none");
        });
        this.loginOptionsModal.onHide(() => {
            $(".account-details-top").css("display", "block");
        });

        // Login and link options mobile
        this.loginOptionsModalMobile = new MenuModal($("#account-login-options-mobile"));
        this.loginOptionsModalMobile.checkSelector = false;
        this.loginOptionsModalMobile.skipFade = true;
        this.loginOptionsModalMobile.onShow(() => {
            $(".account-details-top").css("display", "none");
        });
        this.loginOptionsModalMobile.onHide(() => {
            $(".account-details-top").css("display", "block");
        });

        // Create account
        this.createAccountModal = new MenuModal($("#modal-create-account"));
        this.createAccountModal.onHide(() => {
            this.loadoutMenu.hide();
        });

        this.userCenterModal = new MenuModal($("#modal-user-center"));
        this.userCenterModal.onShow(() => {
            this.renderUserCenter();
        });
        this.userCenterModal.onHide(() => {
            if (isUserCenterHash(window.location.hash)) {
                history.replaceState("", document.title, `${window.location.pathname}${window.location.search}`);
            }
        });

        $(".account-return-user-center").on("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openUserCenter();
        });

        $(
            "#modal-account-name-change, #modal-account-nickname-change, #modal-account-reset-stats, #modal-account-delete, #modal-customize",
        ).find(".close-corner").on("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openUserCenter();
        });

        $("#user-center-refresh").on("click", (event) => {
            event.preventDefault();
            void this.refreshUserCenter();
        });

        // Mobile Accounts Modal
        this.modalMobileAccount = new MenuModal($("#modal-mobile-account"));
        this.modalMobileAccount.onShow(() => {
            $("#start-top-right").css("display", "none");
            $(".account-details-top").css("display", "none");
        });
        this.modalMobileAccount.onHide(() => {
            $("#start-top-right").css("display", "block");
            $(".account-details-top").css("display", "block");
            this.userSettingsModal!.hide();
        });

        //
        // Main-menu buttons
        //

        // Leaderboard
        $(".account-leaderboard-link").on("click", (_e) => {
            window.open("/stats", "_blank");
            return false;
        });
        $(".account-stats-link").on("click", () => {
            this.userCenterModal!.hide();
            this.waitOnLogin(() => {
                if (this.account.loggedIn) {
                    if (this.account.profile.usernameSet) {
                        const slug = this.account.profile.slug || "";
                        window.open(`/stats/?slug=${slug}`, "_blank");
                    } else {
                        this.setNameModal!.show(true);
                    }
                } else {
                    this.showLoginMenu({
                        modal: true,
                    });
                }
            });
            return false;
        });
        $(".account-loadout-link, #btn-customize").on("click", () => {
            this.userCenterModal!.hide();
            this.loadoutMenu.show();
            return false;
        });
        $(".user-center-world-link").on("click", () => {
            this.userCenterModal!.hide();
        });
        $(".account-details-user").on("click", () => {
            this.waitOnLogin(() => {
                if (this.account.loggedIn) {
                    this.renderUserCenter();
                    this.userCenterModal!.show(true);
                } else {
                    this.showLoginMenu({ modal: true });
                }
            });
            return false;
        });
        $(".account-details-user").on("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                $(event.currentTarget).trigger("click");
            }
        });
        $(".btn-account-link").on("click", () => {
            this.userSettingsModal!.hide();
            this.showLoginMenu({
                modal: false,
                link: true,
            });
            return false;
        });
        $(".btn-account-change-name").on("click", () => {
            if (this.account.profile.usernameChangeTime <= 0) {
                this.userSettingsModal!.hide();
                this.userCenterModal!.hide();
                this.modalMobileAccount.hide();
                $("#modal-account-name-title").html(
                    this.localization.translate("index-change-account-name"),
                );
                this.setNameModal!.show();
            }
            return false;
        });
        $(".btn-account-change-nickname").on("click", () => {
            this.userSettingsModal!.hide();
            this.userCenterModal!.hide();
            this.modalMobileAccount.hide();
            this.setNicknameModal!.show();
            return false;
        });
        $(".btn-account-reset-stats").on("click", () => {
            this.userSettingsModal!.hide();
            this.userCenterModal!.hide();
            this.resetStatsModal!.show();
            return false;
        });
        $(".btn-account-delete").on("click", () => {
            this.userSettingsModal!.hide();
            this.userCenterModal!.hide();
            this.deleteAccountModal!.show();
            return false;
        });
        $(".btn-account-logout").on("click", () => {
            this.account.logout();
            return false;
        });
        $("#home-login-primary").on("click", (event) => {
            event.preventDefault();
            this.showLoginMenu({
                modal: true,
            });
        });
        $("#btn-pass-locked").on("click", () => {
            this.showLoginMenu({
                modal: true,
            });
            return false;
        });

        $(".account-block").toggle(this.account.loggedIn);

        window.addEventListener("hashchange", this.openUserCenterFromHash.bind(this));
        this.openUserCenterFromHash();
    }

    openUserCenterFromHash() {
        if (!isUserCenterHash(window.location.hash)) return;
        this.waitOnLogin(() => {
            if (this.account.loggedIn) {
                void this.refreshUserCenter().finally(() => {
                    this.userCenterModal!.show(true);
                });
            } else {
                this.showLoginMenu({ modal: true });
            }
        });
    }

    openUserCenter() {
        this.setNameModal?.hide();
        this.setNicknameModal?.hide();
        this.resetStatsModal?.hide();
        this.deleteAccountModal?.hide();
        this.loadoutMenu.hide();
        this.modalMobileAccount.hide();
        const returnHash = resolveUserCenterReturnHash(window.location.hash);
        if (window.location.hash !== returnHash) {
            window.location.hash = returnHash;
            return;
        }
        this.openUserCenterFromHash();
    }

    onError(type: string, data?: string) {
        const typeText = {
            server_error: "操作失败，请稍后重试。",
            facebook_account_in_use: "关联账号失败，账号已被使用！",
            google_account_in_use: "关联账号失败，账号已被使用！",
            twitch_account_in_use: "关联账号失败，账号已被使用！",
            discord_account_in_use: "关联账号失败，账号已被使用！",
            account_banned: `账号已封禁：${data}`,
            login_failed: "登录失败。",
        };
        const text = typeText[type as keyof typeof typeText];
        if (text) {
            this.errorModal.selector.find(".modal-body-text").html(text);
            this.errorModal.show();
        }
    }

    onLogin() {
        this.createAccountModal!.hide();
        this.userCenterModal!.hide();
        this.loginOptionsModalMobile.hide();
        this.loginOptionsModal!.hide();
        this.setNicknameModal?.hide();
        this.render();
        if (!this.account.profile.usernameSet) {
            this.setNameModal!.show(true);
        }
    }

    onLoadoutUpdated() {
        this.updateUserIcon();
    }

    onItemsUpdated(items: Array<Item>) {
        let unconfirmedItemCount = 0;
        let unackedItemCount = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.status < loadout.ItemStatus.Confirmed) {
                unconfirmedItemCount++;
            }
            if (item.status < loadout.ItemStatus.Ackd) {
                unackedItemCount++;
            }
        }
        items.filter((e) => {
            return e.status < loadout.ItemStatus.Confirmed;
        });
        items.filter((e) => {
            return e.status < loadout.ItemStatus.Ackd;
        });
        const displayAlert = unconfirmedItemCount > 0 || unackedItemCount > 0;
        $("#loadout-alert-main").css({
            display: displayAlert ? "block" : "none",
        });
        this.renderUserCenter();
    }

    onWalletUpdated() {
        this.renderUserCenter();
    }

    onWorldInventoryUpdated() {
        this.renderUserCenter();
    }

    async refreshUserCenter(): Promise<boolean> {
        $("#user-center-refresh-status").text(this.localization.translate("account-refreshing"));
        const refreshed = await this.account.refreshAccountData();
        this.renderUserCenter();
        $("#user-center-refresh-status").text(
            this.localization.translate(refreshed ? "account-refresh-success" : "account-refresh-failed"),
        );
        return refreshed;
    }

    waitOnLogin(cb: () => void) {
        if (this.account.loggingIn && !this.account.loggedIn) {
            const runOnce = () => {
                cb();
                this.account.removeEventListener("requestsComplete", runOnce);
            };
            this.account.addEventListener("requestsComplete", runOnce);
        } else {
            cb();
        }
    }

    showLoginMenu(opts: { modal?: boolean; link?: boolean }) {
        opts = {
            modal: false,
            link: false,
            ...opts,
        };

        const modal = opts.modal
            ? this.createAccountModal
            : device.mobile
            ? this.loginOptionsModalMobile
            : this.loginOptionsModal;
        createLoginOptions(modal!.selector, opts.link, this.account, this.localization);
        modal!.show();
    }

    updateUserIcon() {
        const icon = helpers.getSvgFromGameType(this.account.loadout.player_icon)
            || "img/gui/player-gui.svg";
        $(".account-details-user .account-avatar, .user-center-avatar").css(
            "background-image",
            `url(${icon})`,
        );
    }

    renderUserCenter() {
        const username = this.account.profile.username || this.localization.translate("index-log-in-desc");
        const nickname = this.account.profile.nickname || username;
        const accountId = this.account.profile.slug || "本地账号";
        const walletBalance = this.account.loggedIn && Number.isFinite(this.account.walletBalance)
            ? this.account.walletBalance
            : 0;
        const inventorySize = loadout.getUserAvailableItems(this.account.items).length;
        $("#user-center-nickname").text(nickname);
        $("#user-center-username").text(`账号名 · ${username}`);
        $("#user-center-id").text(`ID · ${accountId}`);
        $("#user-center-points").text(walletBalance.toLocaleString());
        $("#user-center-item-count").text(inventorySize.toLocaleString());
        const worldItems = this.account.worldInventory.filter((item) =>
            item.state === "stash" || item.state === "equipped"
        );
        $("#user-center-world-item-count").text(
            worldItems.reduce((count, item) => count + item.quantity, 0).toLocaleString(),
        );
        const worldItemsList = $("#user-center-world-items").empty();
        if (worldItems.length == 0) {
            $("<li>").text(this.localization.translate("account-no-world-items")).appendTo(worldItemsList);
        } else {
            for (const item of worldItems) {
                const detail = item.durabilityMax > 0
                    ? `${item.durability}/${item.durabilityMax} · ${getWorldItemStateLabel(item.state)}`
                    : `${item.quantity} 件`;
                $("<li>")
                    .append($("<span>").text(`${getWorldItemLabel(item.type)} ×${item.quantity}`))
                    .append($("<span>").addClass("user-center-world-item-detail").text(detail))
                    .appendTo(worldItemsList);
            }
        }
        $("#account-player-id").text(
            `${this.localization.translate("home-account-id")} · ${accountId}`,
        );
        this.updateUserIcon();
    }

    render() {
        // Loading icon
        const loading = this.account.requestsInFlight > 0;
        $(".account-loading").css("opacity", loading ? 1 : 0);

        let usernameText = helpers.htmlEscape(this.account.profile.nickname || this.account.profile.username || "");
        if (!this.account.loggedIn) {
            usernameText = this.account.loggingIn
                ? `${this.localization.translate("index-logging-in")}...`
                : this.localization.translate("index-log-in-desc");
        }
        $("#account-player-name").html(usernameText);
        $("#account-player-name").css(
            "display",
            this.account.loggedIn ? "block" : "none",
        );
        $("#account-login").css("display", this.account.loggedIn ? "none" : "block");
        $(".account-block").toggle(this.account.loggedIn);
        $("#start-menu").toggleClass("is-logged-in", this.account.loggedIn);
        $("#start-menu-wrapper").toggleClass("is-logged-in", this.account.loggedIn);
        $("#start-top-right").toggleClass("home-account-visible", this.account.loggedIn);
        $("#home-nav-loadout").toggleClass("home-nav-account-visible", this.account.loggedIn);
        $("#home-nav-stats").toggleClass("home-nav-account-visible", this.account.loggedIn);
        this.renderUserCenter();
        this.updateUserIcon();
        $("#home-brief-access-value").text(
            this.localization.translate(
                this.account.loggedIn ? "home-brief-access-value-logged-in" : "home-brief-access-value",
            ),
        );
        if (this.account.profile.usernameChangeTime <= 0) {
            $(".btn-account-change-name").removeClass("btn-account-disabled");
        } else {
            $(".btn-account-change-name").addClass("btn-account-disabled");
        }
    }
}
