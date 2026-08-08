import { GameObjectDefs } from "../../shared/defs/register.ts";
import type { ItemInstance } from "../../shared/types/itemInstance.ts";
import type { WorldWeather, WorldWeatherType } from "../../shared/types/worldWeather.ts";
import { formatWorldItemDurability, getWorldItemDurabilityRatio, getWorldItemLabel } from "./worldSettlement.ts";

export const WORLD_WEATHER_LABELS: Record<WorldWeatherType, string> = {
    clear: "晴朗",
    rain: "降雨",
    fog: "浓雾",
    thunderstorm: "雷暴",
};

export const WORLD_TERRAIN_LABELS: Record<string, string> = {
    mud: "泥地",
    flooded: "积水地",
    rockslide: "落石区",
    scorched: "焦土区",
};

export const WORLD_WEATHER_TYPES = [
    "clear",
    "rain",
    "fog",
    "thunderstorm",
] as const satisfies readonly WorldWeatherType[];

export type WorldHudDurabilityGroupKey = "weapon" | "armor" | "other";

export interface WorldHudDurabilityItem {
    type: string;
    label: string;
    durabilityText: string;
    durabilityRatio: number;
    durabilityPercent: number;
    groupKey: WorldHudDurabilityGroupKey;
}

export interface WorldHudDurabilityGroup {
    key: WorldHudDurabilityGroupKey;
    items: readonly WorldHudDurabilityItem[];
}

export interface WorldWeatherVisualState {
    weatherClass: string;
    hudWeatherClass: string;
    impactKey: string;
    intensityPercent: number;
    riskPercent: number;
    overlayOpacity: number;
    showOverlay: boolean;
}

const WORLD_DURABILITY_GROUP_ORDER: readonly WorldHudDurabilityGroupKey[] = ["weapon", "armor", "other"];

const WORLD_WEATHER_OVERLAY_OPACITY: Record<WorldWeatherType, number> = {
    clear: 0,
    rain: 0.18,
    fog: 0.24,
    thunderstorm: 0.3,
};

function isWorldHudDurabilityItem(item: ItemInstance): boolean {
    return item.durabilityMax > 0 && (item.state === "carried" || item.state === "equipped");
}

function worldHudDurabilityGroupKey(type: string): WorldHudDurabilityGroupKey {
    const def = GameObjectDefs.typeToDefSafe(type);
    switch (def?.type) {
        case "gun":
        case "melee":
            return "weapon";
        case "backpack":
        case "chest":
        case "helmet":
        case "outfit":
            return "armor";
        default:
            return "other";
    }
}

export function buildWorldHudDurabilityGroups(items: readonly ItemInstance[]): WorldHudDurabilityGroup[] {
    const grouped = new Map<WorldHudDurabilityGroupKey, WorldHudDurabilityItem[]>();
    for (const key of WORLD_DURABILITY_GROUP_ORDER) {
        grouped.set(key, []);
    }

    for (const item of items) {
        if (!isWorldHudDurabilityItem(item)) continue;
        const durabilityRatio = getWorldItemDurabilityRatio(item);
        const groupKey = worldHudDurabilityGroupKey(item.type);
        grouped.get(groupKey)!.push({
            type: item.type,
            label: getWorldItemLabel(item.type),
            durabilityText: formatWorldItemDurability(item),
            durabilityRatio,
            durabilityPercent: Math.round(durabilityRatio * 100),
            groupKey,
        });
    }

    return WORLD_DURABILITY_GROUP_ORDER
        .map((key) => ({
            key,
            items: grouped.get(key) ?? [],
        }))
        .filter((group) => group.items.length > 0);
}

export function getWorldHudDurabilityCount(groups: readonly WorldHudDurabilityGroup[]): number {
    return groups.reduce((total, group) => total + group.items.length, 0);
}

export function getWorldHudLowestDurabilityPercent(groups: readonly WorldHudDurabilityGroup[]): number | null {
    const percentages = groups.flatMap((group) => group.items.map((item) => item.durabilityPercent));
    return percentages.length ? Math.min(...percentages) : null;
}

export function getWorldWeatherVisualState(
    weather: Pick<WorldWeather, "type" | "phase" | "intensity">,
): WorldWeatherVisualState {
    const intensityPercent = Math.round(Math.max(0, Math.min(1, weather.intensity)) * 100);
    const riskPercent = Math.round(Math.max(0, Math.min(1, weather.intensity)) * 22);
    const overlayOpacity = weather.phase === "warning"
        ? Math.max(0.12, WORLD_WEATHER_OVERLAY_OPACITY[weather.type])
        : WORLD_WEATHER_OVERLAY_OPACITY[weather.type];
    return {
        weatherClass: `world-weather-${weather.type}`,
        hudWeatherClass: `world-hud-weather-${weather.type}`,
        impactKey: weather.type === "clear"
            ? "world-weather-impact-clear"
            : `world-weather-impact-${weather.type}`,
        intensityPercent,
        riskPercent,
        overlayOpacity,
        showOverlay: weather.type !== "clear" || weather.phase === "warning",
    };
}
