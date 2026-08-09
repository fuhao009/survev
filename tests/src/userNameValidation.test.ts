import { describe, expect, test } from "vitest";
import { validateUserName } from "../../server/src/utils/badWords.ts";

describe("user name validation", () => {
    test("accepts Chinese nicknames", () => {
        expect(validateUserName("我是无敌人才")).toEqual({
            originalWasInvalid: false,
            validName: "我是无敌人才",
        });
    });

    test("keeps Unicode letters and removes unsupported characters", () => {
        expect(validateUserName("  无敌Player🙂  ")).toEqual({
            originalWasInvalid: false,
            validName: "无敌Player",
        });
    });

    test("rejects names that become empty after sanitizing", () => {
        expect(validateUserName("🙂🔥")).toEqual({
            originalWasInvalid: true,
            validName: "Player",
        });
    });
});
