import $ from "jquery";
import * as PIXI from "pixi.js-legacy";
import { GameConfig } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import type {
    FindGameBody,
    FindGameError,
    FindGameMatchData,
    FindGameResponse,
    GameWsDisconnectReason,
} from "../../shared/types/api.ts";
import type { WorldActionResponse, WorldEnterResponse, WorldSnapshot } from "../../shared/types/worldApi.ts";
import type { WorldWeatherType } from "../../shared/types/worldWeather.ts";
import { math } from "../../shared/utils/math.ts";
import { Account } from "./account.ts";
import { Ambiance } from "./ambiance.ts";
import { api } from "./api.ts";
import { AudioManager } from "./audioManager.ts";
import { ConfigManager, type ConfigType } from "./config.ts";
import { device } from "./device.ts";
import { errorLogManager } from "./errorLogs.ts";
import { Game } from "./game.ts";
import { helpers } from "./helpers.ts";
import { InputHandler } from "./input.ts";
import { InputBinds, InputBindUi } from "./inputBinds.ts";
import { PingTest } from "./pingTest.ts";
import { proxy } from "./proxy.ts";
import { ResourceManager } from "./resources.ts";
import { SDK } from "./sdk/sdk.ts";
import { SiteInfo } from "./siteInfo.ts";
import { LoadoutMenu } from "./ui/loadoutMenu.ts";
import { Localization } from "./ui/localization.ts";
import Menu from "./ui/menu.ts";
import { MenuModal } from "./ui/menuModal.ts";
import { LoadoutDisplay } from "./ui/opponentDisplay.ts";
import { Pass } from "./ui/pass.ts";
import { ProfileUi } from "./ui/profileUi.ts";
import { TeamMenu } from "./ui/teamMenu.ts";
import { loadStaticDomImages } from "./ui/ui2.ts";
import {
    buildDeadWorldResult,
    buildExtractedWorldResult,
    getWorldItemStateLabel,
    WORLD_RESULT_RETURN_HASH,
    type WorldResultViewModel,
} from "./worldSettlement.ts";

const WORLD_WEATHER_LABELS: Record<WorldWeatherType, string> = {
    clear: "晴朗",
    rain: "降雨",
    fog: "浓雾",
    thunderstorm: "雷暴",
};

export class Application {
    nameInput = $("#player-name-input-solo");
    serverSelect = $("#server-select-main");
    playMode0Btn = $("#btn-start-mode-0");
    playMode1Btn = $("#btn-start-mode-1");
    playMode2Btn = $("#btn-start-mode-2");
    worldPlayBtn = $("#btn-start-world");
    muteBtns = $(".btn-sound-toggle");
    aimLineBtn = $("#btn-game-aim-line");
    masterSliders = $<HTMLInputElement>(".sl-master-volume");
    soundSliders = $<HTMLInputElement>(".sl-sound-volume");
    musicSliders = $<HTMLInputElement>(".sl-music-volume");
    serverWarning = $("#server-warning");
    languageSelect = $<HTMLSelectElement>(".language-select");
    startMenuWrapper = $("#start-menu-wrapper");
    gameAreaWrapper = $("#game-area-wrapper");
    playButtons = $(".play-button-container");
    playLoading = $(".play-loading-outer");
    errorModal = new MenuModal($("#modal-notification"));
    refreshModal = new MenuModal($("#modal-refresh"));
    ipBanModal = new MenuModal($("#modal-ip-banned"));
    config = new ConfigManager();
    localization = new Localization();

    account!: Account;
    loadoutMenu!: LoadoutMenu;
    pass!: Pass;
    profileUi!: ProfileUi;

    pingTest = new PingTest();
    audioManager = new AudioManager();
    ambience = new Ambiance();

    siteInfo!: SiteInfo;
    teamMenu!: TeamMenu;

    pixi: PIXI.Application<PIXI.ICanvas> | null = null;
    resourceManager: ResourceManager | null = null;
    input: InputHandler | null = null;
    inputBinds: InputBinds | null = null;
    inputBindUi: InputBindUi | null = null;
    game: Game | null = null;
    loadoutDisplay: LoadoutDisplay | null = null;
    domContentLoaded = false;
    configLoaded = false;
    initialized = false;
    active = false;
    sessionId = helpers.random64();
    contextListener = function(e: MouseEvent) {
        e.preventDefault();
    };

    errorMessage = "";
    quickPlayPendingModeIdx = -1;
    worldPlayPending = false;
    worldSessionActive = false;
    worldSnapshot: WorldSnapshot | null = null;
    worldDeathPending = false;
    worldPollTimer: number | null = null;
    worldResultView: WorldResultViewModel | null = null;
    findGameAttempts = 0;
    findGameTime = 0;
    pauseTime = 0;
    wasPlayingVideo = false;
    checkedPingTest = false;
    hasFocus = true;

    updateLogoBasedOnLanguage(lang: string) {
        const header = $("#start-row-header");
        if (!header.length) return;
        header.toggleClass("lang-ru", lang === "ru");
    }

    constructor() {
        this.account = new Account(this.config);
        this.loadoutMenu = new LoadoutMenu(this.account, this.localization);
        this.pass = new Pass(this.account, this.loadoutMenu, this.localization);
        this.profileUi = new ProfileUi(
            this.account,
            this.localization,
            this.loadoutMenu,
            this.errorModal,
        );
        this.siteInfo = new SiteInfo(this.config, this.localization);

        this.teamMenu = new TeamMenu(
            this.config,
            this.pingTest,
            this.siteInfo,
            this.localization,
            this.audioManager,
            this.onTeamMenuJoinGame.bind(this),
            this.onTeamMenuLeave.bind(this),
            this.ensureLoggedIn.bind(this),
        );

        const onLoadComplete = () => {
            this.config.load(() => {
                this.configLoaded = true;
                this.tryLoad();
            });
        };
        this.loadBrowserDeps(onLoadComplete);
    }

    async loadBrowserDeps(onLoadCompleteCb: () => void) {
        await SDK.init(this);
        onLoadCompleteCb();
    }

    tryLoad() {
        if (this.domContentLoaded && this.configLoaded && !this.initialized) {
            this.initialized = true;
            // this should be this.config.config.teamAutofill = true???
            // this.config.teamAutoFill = true;
            if (device.mobile) {
                Menu.applyMobileBrowserStyling(device.tablet);
            }
            if (SDK.isSpellSync) {
                this.localization.setLocale(window.spellSync.language);
                this.updateLogoBasedOnLanguage(window.spellSync.language);
            } else {
                const language = this.config.get("language") || this.localization.detectLocale();
                this.config.set("language", language);
                this.localization.setLocale(language);
                this.updateLogoBasedOnLanguage(language);
            }
            this.localization.populateLanguageSelect();
            this.startPingTest();
            this.siteInfo.load();
            this.localization.localizeIndex();
            this.account.init();

            this.nameInput.attr("maxLength", net.Constants.PlayerNameMaxLen);

            this.playMode0Btn.on("click", () => {
                this.runWhenLoggedIn(() => {
                    SDK.requestMidGameAd(() => {
                        this.tryQuickStartGame(0);
                    });
                });
            });
            this.playMode1Btn.on("click", () => {
                this.runWhenLoggedIn(() => {
                    SDK.requestMidGameAd(() => {
                        this.tryQuickStartGame(1);
                    });
                });
            });
            this.playMode2Btn.on("click", () => {
                this.runWhenLoggedIn(() => {
                    SDK.requestMidGameAd(() => {
                        this.tryQuickStartGame(2);
                    });
                });
            });
            this.worldPlayBtn.on("click", () => {
                this.runWhenLoggedIn(() => {
                    void this.startWorld();
                });
            });
            $("#world-extract").on("click", () => {
                void this.extractWorld();
            });
            $("#world-return-home").on("click", () => {
                this.returnToUserCenter();
            });
            $("#world-result-user-center").on("click", () => {
                this.returnToUserCenter();
            });

            this.serverSelect.on("change", () => {
                const t = this.serverSelect.find(":selected").val();
                this.config.set("region", t as string);
            });
            this.nameInput.on("blur", (_t) => {
                this.setConfigFromDOM();
            });
            this.muteBtns.on("click", (_t) => {
                this.config.set("muteAudio", !this.config.get("muteAudio"));
            });
            this.muteBtns.on("mousedown", (e) => {
                e.stopPropagation();
            });
            $(this.masterSliders).on("mousedown", (e) => {
                e.stopPropagation();
            });
            $(this.soundSliders).on("mousedown", (e) => {
                e.stopPropagation();
            });
            $(this.musicSliders).on("mousedown", (e) => {
                e.stopPropagation();
            });
            this.masterSliders.on("input", (t) => {
                const r = Number($(t.target).val()) / 100;
                this.audioManager.setMasterVolume(r);
                this.config.set("masterVolume", r);
            });
            this.soundSliders.on("input", (t) => {
                const r = Number($(t.target).val()) / 100;
                this.audioManager.setSoundVolume(r);
                this.config.set("soundVolume", r);
            });
            this.musicSliders.on("input", (t) => {
                const r = Number($(t.target).val()) / 100;
                this.audioManager.setMusicVolume(r);
                this.config.set("musicVolume", r);
            });
            $(".modal-settings-item")
                .children("input")
                .each((_t, r) => {
                    const a = $(r);
                    a.prop("checked", this.config.get(a.prop("id")));
                });
            $(".modal-settings-item > input:checkbox").on("change", (t) => {
                const r = $(t.target);
                this.config.set(r.prop("id"), r.is(":checked"));
            });
            $(".btn-fullscreen-toggle").on("click", () => {
                helpers.toggleFullScreen();
            });
            this.languageSelect.on("change", (t) => {
                const r = t.target.value;
                if (r) {
                    this.config.set("language", r as ConfigType["language"]);
                    if (SDK.isSpellSync && window.spellSync) {
                        window.spellSync.changeLanguage(r);
                    }
                    this.updateLogoBasedOnLanguage(r);
                }
            });
            $("#btn-create-team").on("click", () => {
                this.tryJoinTeam(true);
            });
            $("#btn-team-mobile-link-join").on("click", () => {
                let t = $<HTMLInputElement>("#team-link-input").val()!.trim()!;
                const r = t.indexOf("#");
                if (r >= 0) {
                    t = t.slice(r + 1);
                }
                if (t.length > 0) {
                    $("#team-mobile-link").css("display", "none");
                    this.tryJoinTeam(false, t);
                } else {
                    $("#team-mobile-link-desc").css("display", "none");
                    $("#team-mobile-link-warning").css("display", "none").fadeIn(100);
                }
            });
            $("#btn-team-leave").on("click", () => {
                if (window.history) {
                    window.history.replaceState("", "", "/");
                }
                this.game?.free();
                this.teamMenu.leave();
            });

            $("#pass-wrapper").show();
            this.setDOMFromConfig();
            this.setAppActive(true);
            const domCanvas = document.querySelector<HTMLCanvasElement>("#cvs")!;

            const rendererRes = window.devicePixelRatio > 1 ? 2 : 1;

            if (device.os == "ios") {
                PIXI.settings.PRECISION_FRAGMENT = PIXI.PRECISION.HIGH;
            }

            const createPixiApplication = (forceCanvas: boolean) => {
                return new PIXI.Application({
                    width: window.innerWidth,
                    height: window.innerHeight,
                    view: domCanvas,
                    antialias: false,
                    resolution: rendererRes,
                    hello: true,
                    forceCanvas,
                });
            };
            let pixi = null;
            try {
                pixi = createPixiApplication(false);
            } catch (_e) {
                pixi = createPixiApplication(true);
            }
            this.pixi = pixi;
            this.pixi.renderer.events.destroy();
            this.pixi.ticker.add(this.update, this);
            this.pixi.renderer.background.color = 7378501;
            this.resourceManager = new ResourceManager(
                this.pixi.renderer,
                this.audioManager,
                this.config,
            );
            this.resourceManager.loadMapAssets("main");
            this.input = new InputHandler(document.getElementById("game-touch-area")!);
            this.inputBinds = new InputBinds(this.input, this.config);
            this.inputBindUi = new InputBindUi(
                this.input,
                this.inputBinds,
                this.localization,
            );
            const onJoin = () => {
                this.loadoutDisplay!.free();
                this.game!.init();
                this.onResize();
                this.findGameAttempts = 0;
                this.ambience.onGameStart();
            };
            const onQuit = (errMsg?: GameWsDisconnectReason) => {
                if (this.game!.m_updatePass) {
                    this.pass.scheduleUpdatePass(this.game!.m_updatePassDelay);
                }
                this.game!.free();
                this.errorMessage = errMsg ? this.getErrorString(errMsg, "host_closed") : "";
                this.teamMenu.onGameComplete(this.errorMessage);
                this.ambience.onGameComplete(this.audioManager);
                this.setAppActive(true);
                this.setPlayLockout(false);

                if (errMsg == "invalid_protocol") {
                    this.showInvalidProtocolModal();
                }
                if (errMsg == "behind_proxy" || errMsg == "ip_banned") {
                    this.showErrorModal(errMsg);
                }
                if (errMsg) {
                    console.warn("Quitting", errMsg);
                }

                SDK.gamePlayStop();
            };
            this.game = new Game(
                this.pixi,
                this.audioManager,
                this.localization,
                this.config,
                this.input,
                this.inputBinds,
                this.inputBindUi,
                this.ambience,
                this.resourceManager,
                onJoin,
                onQuit,
                () => this.onWorldPlayerDeath(),
            );
            this.loadoutDisplay = new LoadoutDisplay(
                this.pixi,
                this.audioManager,
                this.config,
                this.inputBinds,
                this.account,
            );
            this.loadoutMenu.loadoutDisplay = this.loadoutDisplay;
            this.onResize();
            if (window.location.hash === "#user-center") {
                this.profileUi.openUserCenterFromHash();
            } else {
                this.tryJoinTeam(false);
            }
            Menu.setupModals(this.inputBinds, this.inputBindUi);
            this.onConfigModified();
            this.config.addModifiedListener(this.onConfigModified.bind(this));
            loadStaticDomImages();

            SDK.gameLoadComplete();
        }
    }

    onUnload() {
        this.teamMenu.leave();
    }

    onResize() {
        device.onResize();
        Menu.onResize();
        this.loadoutMenu.onResize();
        this.pixi?.renderer.resize(device.screenWidth, device.screenHeight);
        if (this.game?.initialized) {
            this.game.resize();
        }
        if (this.loadoutDisplay?.initialized) {
            this.loadoutDisplay.resize();
        }
        this.refreshUi();
    }

    startPingTest() {
        const regions = this.config.get("regionSelected")
            ? [this.config.get("region")!]
            : this.pingTest.getRegionList();
        this.pingTest.start(regions);
    }

    setAppActive(active: boolean) {
        this.active = active;
        this.quickPlayPendingModeIdx = -1;
        this.worldPlayPending = false;
        if (active) this.stopWorldSession();
        this.refreshUi();

        // Certain systems, like the account, can throw errors
        // while the user is already in a game.
        // Seeing these errors when returning to the menu would be
        // confusing, so we'll hide the modal instead.
        if (active) {
            this.errorModal.hide();
        }
    }

    setPlayLockout(lock: boolean) {
        let delay = lock ? 0 : 1000;
        if (IS_DEV) {
            delay = 0;
        }
        this.playButtons
            .stop()
            .delay(delay)
            .animate(
                {
                    opacity: lock ? 0.5 : 1,
                },
                IS_DEV ? 0 : 250,
            );
        this.playLoading
            .stop()
            .delay(delay)
            .animate(
                {
                    opacity: lock ? 1 : 0,
                },
                {
                    duration: IS_DEV ? 0 : 250,
                    start: () => {
                        this.playLoading.css({
                            "pointer-events": lock ? "initial" : "none",
                        });
                    },
                },
            );
    }

    onTeamMenuJoinGame(data: FindGameMatchData) {
        this.waitOnAccount(() => {
            this.joinGame(data, false);
        });
    }

    onTeamMenuLeave(errTxt?: string) {
        if (errTxt && window.history) {
            window.history.replaceState("", "", "/");
        }

        this.errorMessage = errTxt || "";
        this.setDOMFromConfig();
        this.refreshUi();
    }

    // Config
    setConfigFromDOM() {
        const playerName = helpers.sanitizeNameInput(this.nameInput.val() as string);
        this.config.set("playerName", playerName);
        const region = this.serverSelect.find(":selected").val();
        this.config.set("region", region as string);
    }

    setDOMFromConfig() {
        if (SDK.isAnySDK && !this.config.get("playerName")) {
            SDK.getPlayerName().then((username) => {
                if (!username) return;
                this.config.set("playerName", username);
                this.nameInput.val(username);
            });
        }

        this.nameInput.val(this.config.get("playerName")!);
        this.serverSelect.find("option").each((_i, ele) => {
            const spellSyncLang = SDK.isSpellSync && window.spellSync.language;
            const configRegion = this.config.get("region");
            ele.selected = spellSyncLang
                ? ele.value === spellSyncLang
                : ele.value === configRegion;
        });
        this.languageSelect.val(this.localization.getLocale());
    }

    onConfigModified(key?: string) {
        const muteAudio = this.config.get("muteAudio")!;
        if (muteAudio != this.audioManager.mute) {
            this.muteBtns.removeClass(muteAudio ? "audio-on-icon" : "audio-off-icon");
            this.muteBtns.addClass(muteAudio ? "audio-off-icon" : "audio-on-icon");
            this.audioManager.setMute(muteAudio);
        }

        const masterVolume = this.config.get("masterVolume")!;
        this.masterSliders.val(masterVolume * 100);
        this.audioManager.setMasterVolume(masterVolume);

        const soundVolume = this.config.get("soundVolume")!;
        this.soundSliders.val(soundVolume * 100);
        this.audioManager.setSoundVolume(soundVolume);

        const musicVolume = this.config.get("musicVolume")!;
        this.musicSliders.val(musicVolume * 100);
        this.audioManager.setMusicVolume(musicVolume);

        if (key == "language") {
            const language = this.config.get("language")!;
            this.localization.setLocale(language);
            this.updateLogoBasedOnLanguage(language);
        }

        if (key == "region") {
            this.config.set("regionSelected", true);
            this.startPingTest();
        }

        if (key == "highResTex") {
            location.reload();
        }

        if (key === "debugHUD") {
            this.game?.debugHUD?.onConfigModified();
        }
    }

    refreshUi() {
        this.startMenuWrapper.css("display", this.active ? "flex" : "none");
        this.gameAreaWrapper.css({
            display: this.active ? "none" : "block",
            opacity: this.active ? 0 : 1,
        });
        if (this.active) {
            $("body").removeClass("user-select-none");
            document.removeEventListener("contextmenu", this.contextListener);
        } else {
            $("body").addClass("user-select-none");
            $("#start-main").stop(true);
            document.addEventListener("contextmenu", this.contextListener);
        }

        // Hide the left section if on mobile, oriented portrait, and viewing create team
        $("#ad-block-left").css(
            "display",
            !device.isLandscape && this.teamMenu.active ? "none" : "block",
        );

        // Warning
        const hasError = this.active && this.errorMessage != "";
        this.serverWarning.css({
            display: "block",
            opacity: hasError ? 1 : 0,
        });
        this.serverWarning.html(this.errorMessage);

        const updateButton = (ele: JQuery<HTMLElement>, gameModeIdx: number) => {
            ele.html(
                this.quickPlayPendingModeIdx === gameModeIdx
                    ? "<div class=\"ui-spinner\"></div>"
                    : this.localization.translate(ele.data("l10n")),
            );
        };

        updateButton(this.playMode0Btn, 0);
        updateButton(this.playMode1Btn, 1);
        updateButton(this.playMode2Btn, 2);
        this.worldPlayBtn.html(
            this.worldPlayPending ? "<div class=\"ui-spinner\"></div>" : "进入大世界",
        );
    }

    async startWorld() {
        if (!this.ensureLoggedIn() || this.worldPlayPending || this.quickPlayPendingModeIdx !== -1) {
            return;
        }
        this.worldResultView = null;
        this.refreshWorldResult();
        this.worldPlayPending = true;
        this.errorMessage = "";
        this.refreshUi();
        try {
            const response = await fetch(api.resolveUrl("/api/world/enter"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ newLife: true }),
                credentials: proxy.anyLoginSupported() ? "include" : "omit",
                signal: helpers.abortSignal(10 * 1000),
            });
            if (!response.ok) throw new Error(`world_enter_${response.status}`);
            const data = await response.json() as WorldEnterResponse;
            this.worldSnapshot = data.snapshot;
            this.worldDeathPending = false;
            this.worldSessionActive = true;
            this.startWorldPolling();
            this.refreshWorldHud();
            this.tryQuickStartGame(0, true);
        } catch (_err) {
            this.worldPlayPending = false;
            this.errorMessage = "大世界暂时无法进入";
            this.refreshUi();
        }
    }

    startWorldPolling() {
        if (this.worldPollTimer !== null) window.clearInterval(this.worldPollTimer);
        this.worldPollTimer = window.setInterval(() => {
            if (!this.worldSessionActive) return;
            void fetch(api.resolveUrl("/api/world/enter"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
                credentials: proxy.anyLoginSupported() ? "include" : "omit",
            }).then(async (response) => {
                if (!response.ok) return;
                const data = await response.json() as WorldEnterResponse;
                this.worldSnapshot = data.snapshot;
                this.refreshWorldHud();
                if (data.snapshot.life.status === "dead" && !this.worldResultView) {
                    this.game?.free();
                    this.stopWorldPolling();
                    this.worldResultView = buildDeadWorldResult(data.snapshot);
                    this.refreshWorldHud();
                    this.refreshWorldResult();
                }
            }).catch(() => {});
        }, 2500);
    }

    stopWorldPolling() {
        if (this.worldPollTimer !== null) {
            window.clearInterval(this.worldPollTimer);
            this.worldPollTimer = null;
        }
    }

    stopWorldSession() {
        this.worldSessionActive = false;
        this.worldSnapshot = null;
        this.worldDeathPending = false;
        this.stopWorldPolling();
        $("#world-hud").hide();
    }

    refreshWorldResult() {
        const result = this.worldResultView;
        const panel = $("#world-result");
        if (!result) {
            panel.hide().removeClass("world-result-dead");
            return;
        }

        panel
            .css("display", "flex")
            .toggleClass("world-result-dead", result.outcome === "dead");
        $("#world-result-title").text(result.title);
        $("#world-result-summary").text(result.summary);
        $("#world-result-reward").text(result.rewardPoints > 0 ? `+${result.rewardPoints}` : "0");
        $("#world-result-wallet-before").text(result.walletBefore.toLocaleString());
        $("#world-result-wallet-after").text(result.walletAfter.toLocaleString());
        $("#world-result-items-title").text(result.outcome === "extracted" ? "带出并入库" : "掉落清单");
        $("#world-result-warehouse").text(
            result.outcome === "extracted"
                ? `本局带出 ${result.carriedCount} 件 · 当前仓库 ${result.warehouseCount} 件`
                : `本局未入库 · 当前仓库 ${result.warehouseCount} 件`,
        );

        const list = $("#world-result-items").empty();
        if (result.items.length === 0) {
            $("<li>").text(result.outcome === "extracted" ? "本局没有可展示的物品" : "携带物品清单为空").appendTo(list);
            return;
        }
        for (const item of result.items) {
            const detail = item.kind === "equipment" && item.durabilityMax !== undefined
                ? `${item.durability}/${item.durabilityMax} · ${getWorldItemStateLabel(item.state)}`
                : `${item.quantity} 件 · 一次性物品`;
            $("<li>")
                .append($("<span>").text(`${item.label} ×${item.quantity}`))
                .append($("<span>").addClass("world-result-item-detail").text(detail))
                .appendTo(list);
        }
    }

    refreshWorldHud() {
        const snapshot = this.worldSnapshot;
        if (this.worldResultView) {
            $("#world-hud").hide();
            return;
        }
        if (!snapshot || !this.worldSessionActive || this.active) {
            $("#world-hud").hide();
            return;
        }
        $("#world-hud").show();
        const life = snapshot.life;
        const dead = life.status === "dead" || this.worldDeathPending;
        $("#world-hud-life").text(life.status === "alive" && !dead ? `生命 ${life.health}` : "生命已结束");
        const weather = snapshot.weather;
        const weatherLabel = WORLD_WEATHER_LABELS[weather.type];
        const nextWeatherLabel = WORLD_WEATHER_LABELS[weather.nextType || weather.type];
        const weatherWarning = weather.phase === "warning";
        const weatherSecondsLeft = Math.max(0, Math.ceil((weather.endsAt - Date.now()) / 1000));
        $("#world-hud-weather")
            .toggleClass("world-hud-weather-warning", weatherWarning)
            .attr(
                "aria-label",
                weatherWarning
                    ? `天气：${weatherLabel}，即将切换为${nextWeatherLabel}`
                    : `天气：${weatherLabel}`,
            );
        $("#world-hud-weather-name").text(`天气：${weatherLabel}`);
        $("#world-hud-weather-hint").text(
            weatherWarning
                ? `即将切换为${nextWeatherLabel} · ${weatherSecondsLeft} 秒`
                : "当前环境稳定",
        );
        const gear = snapshot.inventory
            .filter((item) => item.state === "carried" || item.state === "equipped")
            .filter((item) => item.durabilityMax > 0)
            .map((item) => `${item.type} ${item.durability}/${item.durabilityMax}`)
            .join(" · ");
        $("#world-hud-gear").text(gear || "没有可用装备");
        const canExtract = !dead && life.status === "alive" && snapshot.canExtract;
        $("#world-extract")
            .toggle(!dead)
            .prop("disabled", !canExtract)
            .attr("aria-disabled", String(!canExtract));
        $("#world-return-home").toggle(dead);
        $("#world-hud-message").text(
            dead
                ? "本次生命已结束，装备已掉落"
                : canExtract
                ? "已进入撤离区"
                : "前往撤离区后可结算",
        );
    }

    returnToWorldHome() {
        this.returnToUserCenter();
    }

    returnToUserCenter() {
        if (
            !this.worldResultView
            && (!this.worldSessionActive || (this.worldSnapshot?.life.status !== "dead" && !this.worldDeathPending))
        ) {
            return;
        }
        this.game?.free();
        this.stopWorldSession();
        this.worldResultView = null;
        this.refreshWorldResult();
        this.setAppActive(true);
        this.setPlayLockout(false);
        this.ambience.onGameComplete(this.audioManager);
        SDK.gamePlayStop();
        this.account.loadWallet();
        if (window.location.hash !== WORLD_RESULT_RETURN_HASH) {
            window.location.hash = WORLD_RESULT_RETURN_HASH;
        }
        this.profileUi.openUserCenter();
        this.refreshUi();
    }

    onWorldPlayerDeath() {
        if (!this.worldSessionActive) return;
        this.worldDeathPending = true;
        this.refreshWorldHud();
    }

    async extractWorld() {
        if (!this.worldSessionActive || this.active) return;
        const message = $("#world-hud-message");
        if (!this.worldSnapshot?.canExtract) {
            message.text("前往撤离区后可结算");
            return;
        }
        message.text("正在结算...");
        try {
            const response = await fetch(api.resolveUrl("/api/world/action"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "extract", expectedRevision: this.worldSnapshot?.life.revision }),
                credentials: proxy.anyLoginSupported() ? "include" : "omit",
            });
            const data = await response.json() as WorldActionResponse | { success: false; error?: string };
            if (!response.ok || !data.success) {
                message.text(data.success === false ? `无法撤离：${data.error || "未知原因"}` : "无法撤离");
                return;
            }
            if (data.settlement?.status !== "finalized" || !this.worldSnapshot) {
                message.text("结算结果暂不可用，请稍后查看用户中心");
                return;
            }
            const before = this.worldSnapshot;
            const result = buildExtractedWorldResult(data.settlement, before, data.snapshot);
            this.game?.free();
            this.stopWorldSession();
            this.setAppActive(true);
            this.setPlayLockout(false);
            this.worldResultView = result;
            this.refreshWorldResult();
            this.account.loadWallet();
            this.ambience.onGameComplete(this.audioManager);
            SDK.gamePlayStop();
            this.refreshUi();
        } catch (_err) {
            message.text("结算请求失败");
        }
    }

    waitOnAccount(cb: () => void) {
        if (this.account.requestsInFlight == 0) {
            cb();
        } else {
            // Wait some maximum amount of time for pending account requests
            const timeout = setTimeout(() => {
                runOnce();
                errorLogManager.storeGeneric("account", "wait_timeout");
            }, 2500);
            const runOnce = () => {
                cb();
                clearTimeout(timeout);
                this.account.removeEventListener("requestsComplete", runOnce);
            };
            this.account.addEventListener("requestsComplete", runOnce);
        }
    }

    ensureLoggedIn() {
        if (this.account.loggedIn) {
            return true;
        }
        this.profileUi.showLoginMenu({ modal: true });
        return false;
    }

    runWhenLoggedIn(cb: () => void) {
        this.waitOnAccount(() => {
            if (this.ensureLoggedIn()) {
                cb();
            }
        });
    }

    tryJoinTeam(create: boolean, url?: string) {
        let roomUrl = url || window.location.hash.slice(1);
        const sdkRoom = SDK.getRoomInviteParam();
        if (sdkRoom) {
            roomUrl = sdkRoom;
            create = false;
        }

        if (!create && roomUrl == "") {
            return;
        }

        this.runWhenLoggedIn(() => {
            if (this.active && this.quickPlayPendingModeIdx === -1) {
                // The main menu and squad menus have separate
                // DOM elements for input, such as player name and
                // selected region. We will stash the menu values
                // into the config so the team menu can read them.
                this.setConfigFromDOM();
                this.teamMenu.connect(create, roomUrl);
                this.refreshUi();
            }
        });
    }

    tryQuickStartGame(gameModeIdx: number, world = false) {
        if (!this.ensureLoggedIn()) {
            return;
        }
        if (this.quickPlayPendingModeIdx === -1) {
            // Update UI to display a spinner on the play button
            this.errorMessage = "";
            this.quickPlayPendingModeIdx = gameModeIdx;
            this.setConfigFromDOM();
            this.refreshUi();

            // Wait some amount of time if we've recently attempted to
            // find a game to prevent spamming the server
            let delay = 0;
            if (this.findGameAttempts > 0 && Date.now() - this.findGameTime < 30000) {
                delay = Math.min(this.findGameAttempts * 2.5 * 1000, 7500);
            } else {
                this.findGameAttempts = 0;
            }
            this.findGameTime = Date.now();
            this.findGameAttempts++;

            // the delay is annoying on dev
            if (IS_DEV) {
                delay = 0;
            }

            const version = GameConfig.protocolVersion;
            let region = this.config.get("region")!;
            const paramRegion = helpers.getParameterByName("region");
            if (paramRegion !== undefined && paramRegion.length > 0) {
                region = paramRegion;
            }
            let zones = this.pingTest.getZones(region);
            const paramZone = helpers.getParameterByName("zone");
            if (paramZone !== undefined && paramZone.length > 0) {
                zones = [paramZone];
            }

            const matchArgs: FindGameBody = {
                version,
                region,
                zones,
                playerCount: 1,
                autoFill: true,
                gameModeIdx,
                world,
            };

            const tryQuickStartGameImpl = () => {
                this.waitOnAccount(() => {
                    this.findGame(matchArgs, {
                        error: (err) => {
                            this.onJoinGameError(err);
                        },
                        success: (data) => {
                            this.joinGame(data, world);
                        },
                        ban: (ban) => {
                            this.showIpBanModal(ban);
                        },
                    });
                });
            };

            if (delay == 0) {
                // We can improve findGame responsiveness by ~30 ms by skipping
                // the 0ms setTimeout
                tryQuickStartGameImpl();
            } else {
                setTimeout(() => {
                    tryQuickStartGameImpl();
                }, delay);
            }
        }
    }

    findGame(
        matchArgs: FindGameBody,
        cbs: {
            error: (err: FindGameError) => void;
            success: (matchData: FindGameMatchData) => void;
            ban: (data: FindGameResponse & { type: "banned" }) => void;
        },
    ) {
        const findGameImpl = (iter: number, maxAttempts: number, token: string) => {
            if (iter >= maxAttempts) {
                cbs.error("full");
                return;
            }
            const retry = () => {
                setTimeout(() => {
                    helpers.verifyTurnstile(
                        this.siteInfo.info.captchaEnabled && !this.account.loggedIn,
                        (token) => {
                            findGameImpl(iter + 1, maxAttempts, token);
                        },
                    );
                }, 500);
            };
            matchArgs.turnstileToken = token;

            fetch(api.resolveUrl("/api/find_game_v2"), {
                method: "POST",
                body: JSON.stringify(matchArgs),
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                },
                credentials: proxy.anyLoginSupported() ? "include" : "omit",
                signal: helpers.abortSignal(10 * 1000),
            }).then(res => res.json()).then((data: FindGameResponse) => {
                if (data.type === "error") {
                    cbs.error(data.error);
                } else if (data.type === "banned") {
                    cbs.ban(data);
                } else if (data.type === "success") {
                    cbs.success(data.res);
                }
            }).catch(() => {
                retry();
            });
        };

        helpers.verifyTurnstile(
            this.siteInfo.info.captchaEnabled && !this.account.loggedIn,
            (token) => {
                findGameImpl(0, 2, token);
            },
        );
    }

    joinGame(matchData: FindGameMatchData, world = false) {
        if (!this.game) {
            setTimeout(() => {
                this.joinGame(matchData, world);
            }, 250);
            return;
        }
        const urls = [...matchData.urls];

        const joinGameImpl = (urls: string[], matchData: FindGameMatchData) => {
            const url = urls.shift();
            if (!url) {
                this.onJoinGameError("join_game_failed");
                return;
            }
            const onFailure = function() {
                joinGameImpl(urls, matchData);
            };
            this.game!.setWorldMode(world);
            this.game!.tryJoinGame(
                url,
                matchData.data,
                onFailure,
            );
        };
        joinGameImpl(urls, matchData);
    }

    getErrorString(err: FindGameError | GameWsDisconnectReason, fallback: "host_closed" | "full") {
        const errMap: Partial<Record<FindGameError | GameWsDisconnectReason, string>> = {
            banned: this.localization.translate("index-ip-banned"),
            behind_proxy: this.localization.translate("index-behind-proxy"),
            find_game_failed: this.localization.translate("index-failed-finding-game"),
            full: this.localization.translate("index-failed-finding-game"),
            host_closed: this.localization.translate("index-host-closed"),
            invalid_captcha: this.localization.translate("index-invalid-captcha"),
            invalid_packet: this.localization.translate("index-invalid-packet"),
            invalid_protocol: this.localization.translate("index-invalid-protocol"),
            login_required: this.localization.translate("index-login-required"),
            ip_banned: this.localization.translate("index-ip-banned"),
            join_game_failed: this.localization.translate("index-failed-joining-game"),
            rate_limited: this.localization.translate("index-rate-limited"),
            server_crashed: this.localization.translate("index-server-crashed"),
            server_restart: this.localization.translate("index-server-restart"),
        };
        return errMap[err] || errMap[fallback]!;
    }

    onJoinGameError(err: FindGameError) {
        if (err === "login_required") {
            this.profileUi.showLoginMenu({ modal: true });
        }
        if (err == "invalid_protocol") {
            this.showInvalidProtocolModal();
        }

        // Forcefully set captcha to enabled if we fail the captcha
        // This can happen if it was disabled when the page loaded which would meant it was sending an empty token
        // And we only fetch the state when the page loads...
        if (err === "invalid_captcha") {
            this.siteInfo.info.captchaEnabled = true;
        }
        if (err == "behind_proxy" || err == "banned") {
            this.showErrorModal(err);
        }

        this.errorMessage = this.getErrorString(err, "full");
        this.quickPlayPendingModeIdx = -1;
        this.worldPlayPending = false;
        this.teamMenu.leave("join_game_failed");
        this.refreshUi();
    }

    showInvalidProtocolModal() {
        this.refreshModal.show(true);
    }

    showIpBanModal(ban: FindGameResponse & { type: "banned" }) {
        $("#modal-ip-banned-reason").text(`原因：${ban.reason}`);

        let expiration = "期限：永久";
        if (!ban.permanent) {
            const expiresIn = new Date(ban.expiresIn);
            const timeLeft = expiresIn.getTime() - Date.now();

            const daysLeft = Math.round(timeLeft / (1000 * 60 * 60 * 24));
            const hoursLeft = Math.round(timeLeft / (1000 * 60 * 60));

            if (daysLeft > 1) {
                expiration = `${daysLeft}天后到期`;
            } else if (hoursLeft > 1) {
                expiration = `${hoursLeft}小时后到期`;
            } else {
                expiration = "一小时内到期";
            }
        }

        $("#modal-ip-banned-expiration").text(expiration);

        this.ipBanModal.show(true);

        this.quickPlayPendingModeIdx = -1;
        this.teamMenu.leave("banned");
        this.refreshUi();
    }

    showErrorModal(err: FindGameError | GameWsDisconnectReason) {
        const text = this.getErrorString(err, "full");
        if (text) {
            this.errorModal.selector.find(".modal-body-text").html(text);
            this.errorModal.show();
        }
    }

    update() {
        const dt = math.clamp(this.pixi!.ticker.elapsedMS / 1000, 0.001, 1 / 8);
        this.pingTest.update(dt);
        if (!this.checkedPingTest && this.pingTest.isComplete()) {
            if (!this.config.get("regionSelected")) {
                const region = this.pingTest.getRegion();

                if (region) {
                    this.config.set("region", region);
                    this.setDOMFromConfig();
                }
            }
            this.checkedPingTest = true;
        }
        this.resourceManager!.update(dt);
        this.audioManager.update(dt);
        this.ambience.update(dt, this.audioManager, !this.active);

        // Game update
        if (this.game?.initialized && this.game.m_playing) {
            if (this.active) {
                this.setAppActive(false);
                this.setPlayLockout(true);
            }
            this.game.update(dt);
        }

        // LoadoutDisplay update
        if (this.active && this.loadoutDisplay && this.game && !this.game.initialized) {
            if (this.loadoutMenu.active) {
                if (!this.loadoutDisplay.initialized) {
                    this.loadoutDisplay.init();
                }
                this.loadoutDisplay.show();
                this.loadoutDisplay.update(dt, this.hasFocus);
            } else {
                this.loadoutDisplay.hide();
            }
        }
        if (!this.active && this.loadoutMenu.active) {
            this.loadoutMenu.hide();
        }
        if (this.active) {
            this.pass?.update(dt);
        }
        this.input!.flush();
    }
}

const App = new Application();

function onPageLoad() {
    App.domContentLoaded = true;
    App.tryLoad();
}

document.addEventListener("DOMContentLoaded", onPageLoad);
window.addEventListener("load", onPageLoad);
window.addEventListener("unload", (_e) => {
    App.onUnload();
});
if (window.location.hash == "#_=_") {
    window.location.hash = "";
    history.pushState("", document.title, window.location.pathname);
}
window.addEventListener("resize", () => {
    App.onResize();
});
window.addEventListener("orientationchange", () => {
    App.onResize();
});
window.addEventListener("hashchange", () => {
    if (window.location.hash !== "#user-center") {
        App.tryJoinTeam(false);
    }
});
window.addEventListener("beforeunload", (e) => {
    if (App.game?.warnPageReload()) {
        // In new browsers, dialogText is overridden by a generic string
        const dialogText = "确定要重新加载游戏吗？";
        e.returnValue = dialogText;
        return dialogText;
    }
});
window.addEventListener("focus", () => {
    App.hasFocus = true;
});
window.addEventListener("blur", () => {
    App.hasFocus = false;
});

const reportedErrors: string[] = [];
window.onerror = function(msg, url, lineNo, columnNo, error) {
    msg = msg || "undefined_error_msg";
    const stacktrace = error ? error.stack : "";

    // don't report useless errors lol
    if (!url || lineNo === undefined || columnNo === undefined) return;

    // ignore errors not generated by our code
    // and also weird errors that don't have a .js file
    if (!url.startsWith(location.href) || !/.js|.ts/.test(url)) return;

    // ignore scrappers
    if (/googlebot|bingbot|yandexbot|mediapartners-google/gi.test(navigator.userAgent)) return;

    const errObj = {
        msg,
        id: App.sessionId,
        url,
        line: lineNo,
        column: columnNo,
        stacktrace,
        browser: navigator.userAgent,
        protocol: GameConfig.protocolVersion,
        clientGitVersion: GIT_VERSION,
        serverGitVersion: App.siteInfo.info.gitRevision,
    };
    const errStr = JSON.stringify(errObj);

    // Don't report the same error multiple times
    if (!reportedErrors.includes(errStr)) {
        reportedErrors.push(errStr);
        errorLogManager.logWindowOnError(errObj);
    }
};
