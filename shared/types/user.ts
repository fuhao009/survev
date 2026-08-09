import { type Item, type Loadout } from "../utils/loadout.ts";
import type { ItemInstance } from "./itemInstance.ts";

export type ProfileResponse =
    | {
        readonly banned: true;
        reason: string;
        success?: false;
    }
    | {
        banned?: false;
        readonly success: true;
        profile: {
            slug: string;
            username: string;
            nickname: string;
            usernameSet: boolean;
            linked: boolean;
            usernameChangeTime: number;
        };
        loadout: Loadout;
        items: Item[];
        /** Latest stashed/equipped/listed persistent-world item state for the account center. */
        worldInventory: ItemInstance[];
    };

export type UsernameResponse =
    | {
        result: "success";
    }
    | {
        result: "failed" | "invalid" | "taken" | "change_time_not_expired";
    };

export type NicknameResponse =
    | {
        result: "success";
    }
    | {
        result: "failed" | "invalid";
    };

//
// PASS
//

export type PassState = {
    type: string;
    level: number;
    xp: number;
    unlocks: Record<string, boolean>;
    newItems: boolean;
};

export type QuestState = {
    idx: number;
    type: string;
    progress: number;
    target: number;
    complete: boolean;
    rerolled: boolean;
    timeToRefresh: number;
};

export type GetPassResponse = {
    success: true;
    pass: PassState;
    quests: QuestState[];
};
