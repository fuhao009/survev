import $ from "jquery";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import type { SiteInfoRes } from "../../shared/types/api.ts";
import { api } from "./api.ts";
import type { ConfigManager } from "./config.ts";
import type { Localization } from "./ui/localization.ts";

export class SiteInfo {
    info = {} as SiteInfoRes;
    loaded = false;

    constructor(
        public config: ConfigManager,
        public localization: Localization,
    ) {
    }

    load() {
        const locale = this.localization.getLocale();

        const mainSelector = $("#server-opts");
        const teamSelector = $("#team-server-opts");

        for (const region in GAME_REGIONS) {
            const data = GAME_REGIONS[region];
            const name = this.localization.translate(data.l10n);
            const elm = `<option value='${region}' data-l10n='${data.l10n}' data-label='${name}'>${name}</option>`;
            mainSelector.append(elm);
            teamSelector.append(elm);
        }

        const siteInfoUrl = api.resolveUrl(`/api/site_info?language=${locale}`);
        fetch(siteInfoUrl)
            .then(async (res) => {
                if (!res.ok) return null;
                const body = await res.text();
                return body.trim() ? JSON.parse(body) as SiteInfoRes : null;
            })
            .then((data) => {
                this.loaded = true;
                if (data) {
                    this.info = data;
                    this.updatePageFromInfo();
                }
            })
            .catch(() => {
                // Keep the static homepage usable when the optional status endpoint is unavailable.
                this.loaded = true;
            });
    }

    getGameModeStyles(): Array<{
        icon?: string;
        buttonCss: string;
        buttonText: string;
        enabled: boolean;
    }> {
        return [];
    }

    updatePageFromInfo() {
        if (this.loaded) {
            // Region pops
            const pops = this.info.pops;
            if (pops) {
                const regions = Object.keys(pops);

                for (let i = 0; i < regions.length; i++) {
                    const region = regions[i];
                    const data = pops[region];
                    const sel = $("#server-opts").children(`option[value="${region}"]`);
                    const players = this.localization.translate("index-players");
                    sel.text(`${sel.data("label")} [${data.playerCount} ${players}]`);
                }
            }
            const mapDef = MapDefs[this.info.clientTheme];
            if (mapDef) {
                this.config.set("cachedBgImg", mapDef.desc.backgroundImg);
                const bg = document.getElementById("background");
                if (bg) {
                    bg.style.backgroundImage = `url(${mapDef.desc.backgroundImg})`;
                }
            }
        }
    }
}
