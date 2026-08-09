import $ from "jquery";
import type { ItemInstance } from "../../../shared/types/itemInstance.ts";
import type {
    MarketIntentStatus,
    MarketIntentView,
    MarketListingMode,
    MarketListingsResponse,
    MarketListingStatus,
    MarketListingView,
    MarketMineResponse,
    MarketMutationResponse,
    MarketTradeView,
} from "../../../shared/types/market.ts";
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

type MarketActionState =
    | { kind: "create"; item: ItemInstance }
    | { kind: "bid"; listing: MarketListingView; minimumAmount: number }
    | { kind: "offer"; listing: MarketListingView };

type MarketFilterState = {
    mode: "" | MarketListingMode;
    sort: "newest" | "price_asc" | "price_desc" | "durability_desc";
    type: string;
    minPrice: string;
    maxPrice: string;
    minDurability: string;
    maxDurability: string;
};

type MarketRowEntry = {
    itemType?: string;
    title: string;
    detail: string;
    actions?: JQuery<HTMLElement>[];
    rowClass?: string;
};

const MARKET_HASH = "#market";

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
    marketHubModal: MenuModal | null = null;
    marketActionModal: MenuModal | null = null;

    loginOptionsModalMobile!: MenuModal;
    modalMobileAccount!: MenuModal;
    private marketListings: MarketListingView[] = [];
    private marketMine: MarketMineResponse = {
        listings: [],
        intents: [],
        receivedIntents: [],
        trades: [],
        holds: [],
    };
    private marketFilters: MarketFilterState = {
        mode: "",
        sort: "newest",
        type: "",
        minPrice: "",
        maxPrice: "",
        minDurability: "",
        maxDurability: "",
    };
    private marketReturnHash = "";
    private marketLoading = false;
    private marketActionState: MarketActionState | null = null;

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
        this.marketHubModal = new MenuModal($("#modal-market-hub"));
        this.marketHubModal.onShow(() => {
            this.modalMobileAccount.hide();
            this.userCenterModal?.hide();
            this.renderMarketHub();
            void this.refreshMarketData();
        });
        this.marketHubModal.onHide(() => {
            if (window.location.hash === MARKET_HASH) {
                if (this.marketReturnHash) {
                    window.location.hash = this.marketReturnHash;
                } else {
                    history.replaceState("", document.title, `${window.location.pathname}${window.location.search}`);
                }
            }
        });
        this.ensureMarketActionModal();

        $(".account-return-user-center").on("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openUserCenter();
        });
        $(".account-market-link").on("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openMarketHub();
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
        $("#user-center-market-refresh").on("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void this.refreshMarketData();
        });
        $("#market-hub-refresh, #market-hub-apply").on("click", (event) => {
            event.preventDefault();
            void this.refreshMarketData();
        });
        $("#market-hub-reset").on("click", (event) => {
            event.preventDefault();
            this.resetMarketFilters();
        });
        $("#market-hub-mode, #market-hub-sort, #market-hub-type, #market-hub-min-price, #market-hub-max-price, #market-hub-min-durability, #market-hub-max-durability")
            .on("change", () => {
                this.marketFilters = this.readMarketFiltersFromDom();
            });
        $("#market-hub-type").on("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                void this.refreshMarketData();
            }
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
        $(".account-loadout-link:not(.user-center-warehouse-link), #btn-customize").on("click", () => {
            this.userCenterModal!.hide();
            this.marketHubModal?.hide();
            this.loadoutMenu.show();
            return false;
        });
        $(".user-center-warehouse-link").on("click", () => {
            this.userCenterModal!.hide();
            this.marketHubModal?.hide();
            this.loadoutMenu.show("warehouse");
            void this.account.refreshAccountData();
            return false;
        });
        $(".user-center-world-link").on("click", () => {
            this.userCenterModal!.hide();
            this.marketHubModal?.hide();
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

        window.addEventListener("hashchange", this.handleRouteHashChange.bind(this));
        this.handleRouteHashChange();
    }

    private ensureMarketActionModal() {
        if (this.marketActionModal) return;

        const modal = $(`
            <div id="modal-market-action" class="modal modal-account">
                <div class="modal-content modal-close market-action-modal">
                    <div class="modal-header modal-header-name">
                        <span class="close close-corner" aria-label="Close"></span>
                        <h2 id="market-action-title"></h2>
                    </div>
                    <div class="modal-body modal-body-name">
                        <div class="market-action-summary">
                            <strong id="market-action-item-name"></strong>
                            <span id="market-action-item-detail"></span>
                        </div>
                        <div class="market-action-form">
                            <label id="market-action-mode-row" class="market-action-field">
                                <span id="market-action-mode-label"></span>
                                <select id="market-action-mode" class="menu-option">
                                    <option value="fixed_price"></option>
                                    <option value="auction"></option>
                                    <option value="offers"></option>
                                </select>
                            </label>
                            <label id="market-action-price-row" class="market-action-field">
                                <span id="market-action-price-label"></span>
                                <input id="market-action-price" class="menu-option" type="number" min="1" step="1">
                            </label>
                        </div>
                        <div id="market-action-hint"></div>
                        <div id="market-action-error"></div>
                    </div>
                    <div class="modal-footer modal-footer-name modal-footer-round">
                        <h3 id="market-action-confirm" class="close-footer"></h3>
                        <h3 id="market-action-cancel" class="close close-footer"></h3>
                    </div>
                </div>
            </div>
        `).appendTo("#modal-screen-block");

        this.marketActionModal = new MenuModal(modal);
        this.marketActionModal.onHide(() => {
            this.marketActionState = null;
            modal.find("#market-action-error").empty();
        });

        modal.find("#market-action-mode").on("change", () => {
            this.updateMarketActionModeVisibility();
        });
        modal.find("#market-action-confirm").on("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void this.submitMarketAction();
        });
    }

    private updateMarketActionModeVisibility() {
        const state = this.marketActionState;
        const modal = this.marketActionModal?.selector;
        if (!state || !modal) return;

        const mode = modal.find("#market-action-mode").val() as MarketListingMode;
        const isCreate = state.kind === "create";
        modal.find("#market-action-price-row").toggle(!isCreate || mode !== "offers");
        if (isCreate) {
            modal.find("#market-action-hint").text(
                this.localization.translate("market-action-hint-create"),
            );
        }
    }

    private openMarketActionModal(state: MarketActionState) {
        this.ensureMarketActionModal();
        this.marketActionState = state;

        const modal = this.marketActionModal!.selector;
        const item = state.kind === "create" ? state.item : state.listing.item;
        const itemDetail = item.durabilityMax > 0
            ? `${item.durability}/${item.durabilityMax} · ${getWorldItemStateLabel(item.state)}`
            : `${item.quantity} × ${getWorldItemLabel(item.type)}`;
        const modeSelect = modal.find("#market-action-mode");
        const priceInput = modal.find("#market-action-price") as JQuery<HTMLInputElement>;

        modal.find(".close-corner").attr(
            "aria-label",
            this.localization.translate("index-close"),
        );
        modal.find("#market-action-cancel").text(
            this.localization.translate("market-action-cancel"),
        );
        modal.find("#market-action-item-name").text(`${getWorldItemLabel(item.type)} ×${item.quantity}`);
        modal.find("#market-action-item-detail").text(itemDetail);
        modal.find("#market-action-error").empty();
        modal.find("#market-action-mode-label").text(this.localization.translate("market-action-mode"));
        modal.find("#market-action-price-label").text(
            state.kind === "create"
                ? this.localization.translate("market-action-price")
                : this.localization.translate("market-action-amount"),
        );
        priceInput.attr(
            "placeholder",
            this.localization.translate(
                state.kind === "create"
                    ? "market-action-price-placeholder"
                    : "market-action-amount-placeholder",
            ),
        );

        modeSelect.find("option[value=\"fixed_price\"]").text(
            this.localization.translate("market-mode-fixed-price"),
        );
        modeSelect.find("option[value=\"auction\"]").text(
            this.localization.translate("market-mode-auction"),
        );
        modeSelect.find("option[value=\"offers\"]").text(
            this.localization.translate("market-mode-offers"),
        );

        if (state.kind === "create") {
            modal.find("#market-action-title").text(this.localization.translate("market-action-create-title"));
            modal.find("#market-action-mode-row").show();
            modal.find("#market-action-confirm").text(
                this.localization.translate("market-action-submit-create"),
            );
            modeSelect.val("fixed_price");
            priceInput.val("");
        } else {
            modal.find("#market-action-mode-row").hide();
            modal.find("#market-action-title").text(
                this.localization.translate(
                    state.kind === "bid" ? "market-action-bid-title" : "market-action-offer-title",
                ),
            );
            modal.find("#market-action-confirm").text(
                this.localization.translate(
                    state.kind === "bid"
                        ? "market-action-submit-bid"
                        : "market-action-submit-offer",
                ),
            );
            priceInput.val(
                state.kind === "bid"
                    ? String(state.minimumAmount)
                    : "",
            );
            modal.find("#market-action-hint").text(
                this.localization.translate(
                    state.kind === "bid"
                        ? "market-action-hint-bid"
                        : "market-action-hint-offer",
                ),
            );
        }

        this.updateMarketActionModeVisibility();
        this.marketActionModal!.show(true);
        priceInput.trigger("focus");
    }

    private async submitMarketAction() {
        const state = this.marketActionState;
        const modal = this.marketActionModal?.selector;
        if (!state || !modal) return;

        const amount = Math.trunc(Number(modal.find("#market-action-price").val()));
        const mode = modal.find("#market-action-mode").val() as MarketListingMode;
        if (state.kind !== "create" || mode !== "offers") {
            if (!Number.isInteger(amount) || amount <= 0) {
                modal.find("#market-action-error").text(this.localization.translate("market-action-error"));
                return;
            }
        }

        let endpoint = "";
        let body: Record<string, unknown> | undefined;
        if (state.kind === "create") {
            endpoint = "/api/market/listings";
            body = {
                itemInstanceId: state.item.instanceId,
                mode,
                price: mode === "offers" ? null : amount,
                clientRequestId: helpers.random64(),
            };
        } else if (state.kind === "bid") {
            endpoint = `/api/market/listings/${encodeURIComponent(state.listing.listingId)}/bid`;
            body = {
                amount,
                clientRequestId: helpers.random64(),
            };
        } else {
            endpoint = `/api/market/listings/${encodeURIComponent(state.listing.listingId)}/offers`;
            body = {
                amount,
                clientRequestId: helpers.random64(),
            };
        }

        const confirmButton = modal.find("#market-action-confirm");
        confirmButton.prop("disabled", true);
        modal.find("#market-action-error").empty();
        try {
            const result = await this.postMarketMutation(endpoint, body);
            if (!result.success) {
                modal.find("#market-action-error").text(this.localization.translate("market-action-error"));
                return;
            }
            this.marketActionModal!.hide();
            await this.refreshUserCenter();
        } finally {
            confirmButton.prop("disabled", false);
        }
    }

    private async postMarketMutation(
        endpoint: string,
        body?: Record<string, unknown>,
    ): Promise<MarketMutationResponse> {
        try {
            const response = await fetch(api.resolveUrl(endpoint), {
                method: "POST",
                credentials: "include",
                headers: body ? { "Content-Type": "application/json" } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            });
            const result = await response.json() as MarketMutationResponse;
            if (!response.ok) {
                return result;
            }
            return result;
        } catch (_error) {
            return { success: false, error: "request_failed" };
        }
    }

    private readMarketFiltersFromDom(): MarketFilterState {
        const modal = this.marketHubModal?.selector;
        if (!modal?.length) return { ...this.marketFilters };
        const read = (selector: string) => String(modal.find(selector).val() ?? "").trim();
        const mode = read("#market-hub-mode");
        const sort = read("#market-hub-sort");
        return {
            mode: mode === "fixed_price" || mode === "auction" || mode === "offers" ? mode : "",
            sort: sort === "price_asc" || sort === "price_desc" || sort === "durability_desc" ? sort : "newest",
            type: read("#market-hub-type"),
            minPrice: read("#market-hub-min-price"),
            maxPrice: read("#market-hub-max-price"),
            minDurability: read("#market-hub-min-durability"),
            maxDurability: read("#market-hub-max-durability"),
        };
    }

    private syncMarketFiltersToDom() {
        const modal = this.marketHubModal?.selector;
        if (!modal?.length) return;
        modal.find("#market-hub-mode").val(this.marketFilters.mode);
        modal.find("#market-hub-sort").val(this.marketFilters.sort);
        modal.find("#market-hub-type").val(this.marketFilters.type);
        modal.find("#market-hub-min-price").val(this.marketFilters.minPrice);
        modal.find("#market-hub-max-price").val(this.marketFilters.maxPrice);
        modal.find("#market-hub-min-durability").val(this.marketFilters.minDurability);
        modal.find("#market-hub-max-durability").val(this.marketFilters.maxDurability);
    }

    private resetMarketFilters() {
        this.marketFilters = {
            mode: "",
            sort: "newest",
            type: "",
            minPrice: "",
            maxPrice: "",
            minDurability: "",
            maxDurability: "",
        };
        this.syncMarketFiltersToDom();
        void this.refreshMarketData();
    }

    private marketListingsEndpoint() {
        const params = new URLSearchParams({
            limit: "24",
            sort: this.marketFilters.sort,
        });
        if (this.marketFilters.mode) params.set("mode", this.marketFilters.mode);
        if (this.marketFilters.type) params.set("type", this.marketFilters.type);
        if (this.marketFilters.minPrice) params.set("minPrice", this.marketFilters.minPrice);
        if (this.marketFilters.maxPrice) params.set("maxPrice", this.marketFilters.maxPrice);
        if (this.marketFilters.minDurability) params.set("minDurability", this.marketFilters.minDurability);
        if (this.marketFilters.maxDurability) params.set("maxDurability", this.marketFilters.maxDurability);
        return `/api/market/listings?${params.toString()}`;
    }

    private marketTypeOptions() {
        const types = new Set<string>();
        for (const listing of [...this.marketListings, ...this.marketMine.listings]) {
            if (listing.item.type) types.add(listing.item.type);
        }
        return [...types].sort((left, right) =>
            getWorldItemLabel(left).localeCompare(getWorldItemLabel(right), undefined, { sensitivity: "base" })
        );
    }

    private renderMarketFilterOptions() {
        const modal = this.marketHubModal?.selector;
        if (!modal?.length) return;
        const typeSelect = modal.find("#market-hub-type").empty();
        $("<option>")
            .attr("value", "")
            .text(this.localization.translate("market-filter-type-all"))
            .appendTo(typeSelect);
        for (const type of this.marketTypeOptions()) {
            $("<option>")
                .attr("value", type)
                .text(getWorldItemLabel(type))
                .appendTo(typeSelect);
        }
        if (this.marketFilters.type && typeSelect.find(`option[value="${this.marketFilters.type}"]`).length === 0) {
            $("<option>")
                .attr("value", this.marketFilters.type)
                .text(getWorldItemLabel(this.marketFilters.type))
                .appendTo(typeSelect);
        }
        this.syncMarketFiltersToDom();
    }

    async refreshMarketData(): Promise<boolean> {
        if (!this.account.loggedIn || this.marketLoading) return false;

        this.marketFilters = this.readMarketFiltersFromDom();
        this.marketLoading = true;
        this.renderMarketHub();
        try {
            const [listingsResponse, mineResponse] = await Promise.all([
                fetch(api.resolveUrl(this.marketListingsEndpoint()), {
                    credentials: "include",
                    signal: helpers.abortSignal(10 * 1000),
                }),
                fetch(api.resolveUrl("/api/market/mine"), {
                    credentials: "include",
                    signal: helpers.abortSignal(10 * 1000),
                }),
            ]);
            if (!listingsResponse.ok || !mineResponse.ok) {
                throw new Error("market_refresh_failed");
            }
            const listings = await listingsResponse.json() as MarketListingsResponse;
            const mine = await mineResponse.json() as MarketMineResponse;
            if (
                !Array.isArray(listings.listings)
                || !Array.isArray(mine.listings)
                || !Array.isArray(mine.intents)
                || !Array.isArray(mine.receivedIntents)
                || !Array.isArray(mine.trades)
                || !Array.isArray(mine.holds)
            ) {
                throw new Error("market_response_invalid");
            }
            this.marketListings = listings.listings;
            this.marketMine = mine;
            this.marketLoading = false;
            this.renderUserCenter();
            this.renderMarketHub();
            $("#market-hub-status").text(this.localization.translate("market-refresh-success"));
            return true;
        } catch (_error) {
            this.marketLoading = false;
            this.renderMarketHub();
            $("#market-hub-status").text(this.localization.translate("market-refresh-failed"));
            return false;
        }
    }

    private activeMineListingForItem(itemInstanceId: string) {
        return this.marketMine.listings.find((listing) =>
            listing.status === "active" && listing.item.instanceId === itemInstanceId
        );
    }

    private activeBidsForListing(listingId: string) {
        return [...this.marketMine.intents, ...this.marketMine.receivedIntents].filter((intent) =>
            intent.listingId === listingId && intent.type === "bid" && intent.status === "active"
        );
    }

    private listingForIntent(intent: MarketIntentView) {
        return this.marketMine.listings.find((listing) => listing.listingId === intent.listingId)
            ?? this.marketListings.find((listing) => listing.listingId === intent.listingId);
    }

    private marketModeLabel(mode: MarketListingMode) {
        switch (mode) {
            case "fixed_price":
                return this.localization.translate("market-mode-fixed-price");
            case "auction":
                return this.localization.translate("market-mode-auction");
            case "offers":
                return this.localization.translate("market-mode-offers");
        }
    }

    private marketStatusLabel(status: MarketListingStatus) {
        switch (status) {
            case "active":
                return this.localization.translate("market-status-active");
            case "sold":
                return this.localization.translate("market-status-sold");
            case "cancelled":
                return this.localization.translate("market-status-cancelled");
            case "expired":
                return this.localization.translate("market-status-expired");
        }
    }

    private marketIntentStatusLabel(status: MarketIntentStatus) {
        switch (status) {
            case "active":
                return this.localization.translate("market-status-active");
            case "accepted":
                return this.localization.translate("market-status-accepted");
            case "rejected":
                return this.localization.translate("market-status-rejected");
            case "cancelled":
                return this.localization.translate("market-status-cancelled");
            case "outbid":
                return this.localization.translate("market-status-outbid");
            case "expired":
                return this.localization.translate("market-status-expired");
        }
    }

    private formatMarketPrice(price: number | null) {
        if (price === null || price === undefined) return "";
        return `${price.toLocaleString()} ${this.localization.translate("market-points-suffix")}`;
    }

    private marketListingSummary(listing: MarketListingView) {
        const mode = this.marketModeLabel(listing.mode);
        if (listing.mode === "offers") return mode;
        const price = listing.mode === "auction"
            ? listing.currentPrice ?? listing.price
            : listing.price;
        return price === null || price === undefined ? mode : `${mode} · ${this.formatMarketPrice(price)}`;
    }

    private createItemIcon(type: string, className: string) {
        const iconSrc = helpers.getSvgFromGameType(type);
        const icon = $("<span>").addClass(className).attr("aria-hidden", "true");
        if (iconSrc) {
            icon.append(
                $("<img>", {
                    alt: "",
                    src: iconSrc,
                }).css("transform", helpers.getCssTransformFromGameType(type)),
            );
        }
        return icon;
    }

    private createMarketActionButton(
        label: string,
        className: string,
        onClick: () => void,
        disabled = false,
    ) {
        return $("<button>", {
            type: "button",
            class: className,
            text: label,
        })
            .prop("disabled", disabled)
            .on("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!disabled) onClick();
            });
    }

    private async buyMarketListing(listing: MarketListingView) {
        if (!window.confirm(this.localization.translate("market-buy-confirm"))) return;
        const result = await this.postMarketMutation(
            `/api/market/listings/${encodeURIComponent(listing.listingId)}/buy`,
        );
        if (!result.success) {
            $("#market-hub-status, #user-center-refresh-status").text(
                this.localization.translate("market-action-error"),
            );
            return;
        }
        await this.refreshUserCenter();
    }

    private async cancelMarketListing(listingId: string) {
        const result = await this.postMarketMutation(
            `/api/market/listings/${encodeURIComponent(listingId)}/cancel`,
        );
        if (!result.success) {
            $("#market-hub-status, #user-center-refresh-status").text(
                this.localization.translate("market-action-error"),
            );
            return;
        }
        await this.refreshUserCenter();
    }

    private async respondToMarketOffer(
        intent: MarketIntentView,
        action: "accept" | "reject" | "cancel",
    ) {
        const result = await this.postMarketMutation(
            `/api/market/offers/${encodeURIComponent(intent.intentId)}/${action}`,
        );
        if (!result.success) {
            $("#market-hub-status, #user-center-refresh-status").text(
                this.localization.translate("market-action-error"),
            );
            return;
        }
        await this.refreshUserCenter();
    }

    private renderWorldInventory(worldItems: ItemInstance[]) {
        const itemCount = worldItems.reduce((count, item) => count + item.quantity, 0);
        $("#user-center-world-items")
            .toggleClass("user-center-world-items-empty", itemCount === 0)
            .text(
                itemCount > 0
                    ? this.localization.translate("account-world-warehouse-summary", {
                        count: itemCount.toLocaleString(),
                    })
                    : this.localization.translate("account-no-world-items"),
            );
    }

    private formatMarketTime(value: string) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleString([], {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    private itemMarketDetail(item: ItemInstance) {
        return item.durabilityMax > 0
            ? `${item.durability}/${item.durabilityMax}`
            : this.localization.translate("world-settlement-consumable-detail", { quantity: item.quantity });
    }

    private listingForTrade(trade: MarketTradeView) {
        return this.marketMine.listings.find((listing) => listing.listingId === trade.listingId)
            ?? this.marketListings.find((listing) => listing.listingId === trade.listingId);
    }

    private renderMarketList(selector: string, entries: MarketRowEntry[], emptyText: string) {
        const list = $(selector).empty();
        if (!list.length) return;

        if (this.marketLoading) {
            $("<li>")
                .addClass("market-hub-empty")
                .text(this.localization.translate("market-refreshing"))
                .appendTo(list);
            return;
        }

        if (entries.length === 0) {
            $("<li>").addClass("market-hub-empty").text(emptyText).appendTo(list);
            return;
        }

        for (const entry of entries) {
            const actionSlot = $("<span>").addClass("market-hub-row-actions");
            for (const action of entry.actions ?? []) {
                actionSlot.append(action);
            }

            $("<li>")
                .addClass(entry.rowClass ?? "")
                .append(
                    entry.itemType
                        ? this.createItemIcon(entry.itemType, "market-hub-item-icon")
                        : $("<span>").addClass("market-hub-item-icon market-hub-item-icon-empty"),
                )
                .append(
                    $("<span>").addClass("market-hub-row-copy").append(
                        $("<strong>").addClass("market-hub-row-title").text(entry.title),
                        $("<span>").addClass("market-hub-row-detail").text(entry.detail),
                    ),
                )
                .append(actionSlot)
                .appendTo(list);
        }
    }

    private renderMarketHub() {
        const activeMineListings = this.marketMine.listings.filter((listing) => listing.status === "active");
        const ownListingIds = new Set(activeMineListings.map((listing) => listing.listingId));
        const activeReceivedOffers = this.marketMine.receivedIntents.filter((intent) =>
            intent.type === "offer" && intent.status === "active"
        );
        const activeMyIntents = this.marketMine.intents.filter((intent) => intent.status === "active");
        const activeHolds = this.marketMine.holds.filter((hold) => hold.status === "active");
        const frozenPoints = activeHolds.reduce((total, hold) => total + hold.amount, 0);
        const stashQuantity = this.account.worldInventory
            .filter((item) => item.state === "stash")
            .reduce((total, item) => total + item.quantity, 0);

        this.renderMarketFilterOptions();
        $("#market-hub-public-count").text(this.marketListings.length.toLocaleString());
        $("#market-hub-my-count").text(activeMineListings.length.toLocaleString());
        $("#market-hub-frozen-count").text(frozenPoints.toLocaleString());
        $("#market-hub-offer-count").text(activeReceivedOffers.length.toLocaleString());
        $("#market-hub-feed-count").text(
            this.localization.translate("market-feed-count", { count: this.marketListings.length }),
        );
        $("#market-hub-warehouse-summary").text(
            this.localization.translate("market-warehouse-summary", { count: stashQuantity.toLocaleString() }),
        );
        $("#user-center-market-count").text(activeMineListings.length.toLocaleString());
        $("#user-center-market-summary").text(
            this.localization.translate("market-user-center-summary", {
                offers: activeReceivedOffers.length.toLocaleString(),
                frozen: frozenPoints.toLocaleString(),
            }),
        );
        const userCenterMarketList = $("#user-center-market-list").empty();
        const userCenterMarketRows = [
            this.localization.translate("market-section-my-listings") + `: ${activeMineListings.length}`,
            this.localization.translate("market-section-received-offers") + `: ${activeReceivedOffers.length}`,
            this.localization.translate("market-section-holds") + `: ${activeHolds.length}`,
        ];
        for (const row of userCenterMarketRows) {
            $("<li>").text(row).appendTo(userCenterMarketList);
        }

        const listingEntries: MarketRowEntry[] = this.marketListings.map((listing) => {
            const actions: JQuery<HTMLElement>[] = [];
            if (ownListingIds.has(listing.listingId)) {
                const cancelBlocked = listing.mode === "auction"
                    && this.activeBidsForListing(listing.listingId).length > 0;
                actions.push(
                    this.createMarketActionButton(
                        cancelBlocked
                            ? this.localization.translate("market-action-cancel-blocked")
                            : this.localization.translate("market-cancel-listing"),
                        "market-hub-row-action",
                        () => {
                            void this.cancelMarketListing(listing.listingId);
                        },
                        cancelBlocked,
                    ),
                );
            } else if (listing.mode === "fixed_price") {
                actions.push(
                    this.createMarketActionButton(
                        this.localization.translate("market-buy"),
                        "market-hub-row-action market-hub-row-action-primary",
                        () => {
                            void this.buyMarketListing(listing);
                        },
                    ),
                );
            } else if (listing.mode === "auction") {
                const currentPrice = listing.currentPrice ?? listing.price ?? 1;
                actions.push(
                    this.createMarketActionButton(
                        this.localization.translate("market-bid"),
                        "market-hub-row-action market-hub-row-action-primary",
                        () => {
                            this.openMarketActionModal({
                                kind: "bid",
                                listing,
                                minimumAmount: currentPrice + 1,
                            });
                        },
                    ),
                );
            } else {
                actions.push(
                    this.createMarketActionButton(
                        this.localization.translate("market-offer"),
                        "market-hub-row-action market-hub-row-action-primary",
                        () => {
                            this.openMarketActionModal({ kind: "offer", listing });
                        },
                    ),
                );
            }
            return {
                itemType: listing.item.type,
                title: `${getWorldItemLabel(listing.item.type)} ×${listing.item.quantity}`,
                detail: `${this.marketListingSummary(listing)} · ${this.itemMarketDetail(listing.item)} · ${
                    this.marketStatusLabel(listing.status)
                } · ${
                    this.localization.translate("market-expires-at", { time: this.formatMarketTime(listing.expiresAt) })
                }`,
                actions,
                rowClass: ownListingIds.has(listing.listingId) ? "market-hub-row-owned" : undefined,
            };
        });
        this.renderMarketList(
            "#market-hub-list",
            listingEntries,
            this.localization.translate("market-no-listings"),
        );

        const myListingEntries = activeMineListings.map((listing) => {
            const cancelBlocked = listing.mode === "auction"
                && this.activeBidsForListing(listing.listingId).length > 0;
            return {
                itemType: listing.item.type,
                title: `${getWorldItemLabel(listing.item.type)} ×${listing.item.quantity}`,
                detail: `${this.marketListingSummary(listing)} · ${
                    this.localization.translate("market-expires-at", { time: this.formatMarketTime(listing.expiresAt) })
                }`,
                actions: [
                    this.createMarketActionButton(
                        cancelBlocked
                            ? this.localization.translate("market-action-cancel-blocked")
                            : this.localization.translate("market-cancel-listing"),
                        "market-hub-row-action",
                        () => {
                            void this.cancelMarketListing(listing.listingId);
                        },
                        cancelBlocked,
                    ),
                ],
            } satisfies MarketRowEntry;
        });
        this.renderMarketList(
            "#market-hub-my-listings",
            myListingEntries,
            this.localization.translate("market-no-my-listings"),
        );

        const receivedOfferEntries = activeReceivedOffers.map((intent) => {
            const listing = this.listingForIntent(intent);
            const item = listing?.item;
            return {
                itemType: item?.type,
                title: item
                    ? `${getWorldItemLabel(item.type)} ×${item.quantity}`
                    : this.localization.translate("market-received-offer"),
                detail: `${this.localization.translate("market-received-offer")} · ${
                    this.formatMarketPrice(intent.amount)
                } · ${this.marketIntentStatusLabel(intent.status)}`,
                actions: [
                    this.createMarketActionButton(
                        this.localization.translate("market-accept-offer"),
                        "market-hub-row-action market-hub-row-action-primary",
                        () => {
                            void this.respondToMarketOffer(intent, "accept");
                        },
                    ),
                    this.createMarketActionButton(
                        this.localization.translate("market-reject-offer"),
                        "market-hub-row-action",
                        () => {
                            void this.respondToMarketOffer(intent, "reject");
                        },
                    ),
                ],
            } satisfies MarketRowEntry;
        });
        this.renderMarketList(
            "#market-hub-received-offers",
            receivedOfferEntries,
            this.localization.translate("market-no-received-offers"),
        );

        const myIntentEntries = activeMyIntents.map((intent) => {
            const listing = this.listingForIntent(intent);
            const item = listing?.item;
            const actions: JQuery<HTMLElement>[] = [];
            if (intent.type === "offer") {
                actions.push(
                    this.createMarketActionButton(
                        this.localization.translate("market-cancel-offer"),
                        "market-hub-row-action",
                        () => {
                            void this.respondToMarketOffer(intent, "cancel");
                        },
                    ),
                );
            }
            return {
                itemType: item?.type,
                title: item
                    ? `${getWorldItemLabel(item.type)} ×${item.quantity}`
                    : this.localization.translate(intent.type === "bid" ? "market-my-bid" : "market-my-offer"),
                detail: `${
                    this.localization.translate(intent.type === "bid" ? "market-my-bid" : "market-my-offer")
                } · ${this.formatMarketPrice(intent.amount)} · ${this.marketIntentStatusLabel(intent.status)}`,
                actions,
            } satisfies MarketRowEntry;
        });
        this.renderMarketList(
            "#market-hub-my-intents",
            myIntentEntries,
            this.localization.translate("market-no-my-intents"),
        );

        const holdEntries = activeHolds.map((hold) => {
            const intent = this.marketMine.intents.find((row) => row.intentId === hold.intentId);
            const listing = intent ? this.listingForIntent(intent) : undefined;
            return {
                itemType: listing?.item.type,
                title: this.formatMarketPrice(hold.amount),
                detail: `${this.localization.translate("market-status-active")} · ${
                    listing
                        ? getWorldItemLabel(listing.item.type)
                        : this.localization.translate("market-frozen-points", {
                            points: hold.amount.toLocaleString(),
                        })
                }`,
            } satisfies MarketRowEntry;
        });
        this.renderMarketList(
            "#market-hub-holds",
            holdEntries,
            this.localization.translate("market-no-holds"),
        );

        const tradeEntries = this.marketMine.trades.slice(0, 6).map((trade) => {
            const listing = this.listingForTrade(trade);
            return {
                itemType: listing?.item.type,
                title: listing
                    ? `${getWorldItemLabel(listing.item.type)} ×${listing.item.quantity}`
                    : this.localization.translate("market-trade-history"),
                detail: `${this.formatMarketPrice(trade.price)} · ${
                    this.localization.translate("market-trade-fee", {
                        fee: trade.fee.toLocaleString(),
                        proceeds: trade.sellerProceeds.toLocaleString(),
                    })
                }`,
            } satisfies MarketRowEntry;
        });
        this.renderMarketList(
            "#market-hub-trades",
            tradeEntries,
            this.localization.translate("market-no-trades"),
        );

        $("#market-hub-status").text(
            this.marketLoading
                ? this.localization.translate("market-refreshing")
                : this.localization.translate("market-market-status", {
                    listingCount: activeMineListings.length,
                    frozenPoints: frozenPoints.toLocaleString(),
                }),
        );
        $("#market-hub-refresh, #market-hub-apply, #market-hub-reset").prop("disabled", this.marketLoading);
    }

    private renderMarketListings() {
        this.renderMarketHub();
    }

    private handleRouteHashChange() {
        if (window.location.hash === MARKET_HASH) {
            this.openMarketHubFromHash();
            return;
        }
        if (isUserCenterHash(window.location.hash)) {
            this.openUserCenterFromHash();
            return;
        }
        this.marketHubModal?.hide();
        this.userCenterModal?.hide();
    }

    openUserCenterFromHash() {
        if (!isUserCenterHash(window.location.hash)) return;
        this.marketHubModal?.hide();
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

    openMarketHubFromHash() {
        if (window.location.hash !== MARKET_HASH) return;
        this.waitOnLogin(() => {
            if (this.account.loggedIn) {
                this.setNameModal?.hide();
                this.setNicknameModal?.hide();
                this.resetStatsModal?.hide();
                this.deleteAccountModal?.hide();
                this.loadoutMenu.hide();
                this.modalMobileAccount.hide();
                this.userCenterModal?.hide();
                this.marketHubModal!.show(true);
            } else {
                this.showLoginMenu({ modal: true });
            }
        });
    }

    openMarketHub() {
        this.marketReturnHash = isUserCenterHash(window.location.hash)
            ? resolveUserCenterReturnHash(window.location.hash)
            : "";
        if (window.location.hash !== MARKET_HASH) {
            window.location.hash = MARKET_HASH;
            return;
        }
        this.openMarketHubFromHash();
    }

    openUserCenter() {
        this.setNameModal?.hide();
        this.setNicknameModal?.hide();
        this.resetStatsModal?.hide();
        this.deleteAccountModal?.hide();
        this.loadoutMenu.hide();
        this.modalMobileAccount.hide();
        this.marketHubModal?.hide();
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
        this.marketHubModal?.hide();
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
        await this.refreshMarketData();
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
            item.state === "stash" || item.state === "equipped" || item.state === "listed"
        );
        $("#user-center-world-item-count").text(
            worldItems.reduce((count, item) => count + item.quantity, 0).toLocaleString(),
        );
        this.renderWorldInventory(worldItems);
        this.renderMarketListings();
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
