import { and, desc, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { isIP } from "node:net";
import { db } from "../api/db/index.ts";
import { userQuestTable, usersTable, worldLivesTable } from "../api/db/schema.ts";
import { Config } from "../config.ts";
import type { FindGamePrivateBody } from "../utils/types.ts";

export function getHonoIp(c: Context, proxyHeader?: string): string | undefined {
    const ip = proxyHeader
        ? c.req.header(proxyHeader)
        : c.env?.incoming?.socket?.remoteAddress;

    if (!ip || isIP(ip) == 0) return undefined;
    if (ip.includes("::ffff:")) return ip.split("::ffff:")[1];
    return ip;
}

export function getDebugRequestContext(c: Context) {
    return {
        debugSession: c.req.header("x-survev-debug-session") || undefined,
        debugFlow: c.req.header("x-survev-debug-flow") || undefined,
        method: c.req.method,
        path: c.req.path,
    };
}

export async function verifyTurnsStile(token: string, ip: string): Promise<boolean> {
    const url = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
    const result = await fetch(url, {
        body: JSON.stringify({
            secret: Config.secrets.TURNSTILE_SECRET_KEY,
            response: token,
            remoteip: ip,
        }),
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
    });

    const outcome = await result.json();

    if (!outcome.success) {
        return false;
    }
    return true;
}

export async function getFindGamePlayerData(
    players: FindGamePrivateBody["playerData"],
    options: { world?: boolean } = {},
): Promise<FindGamePrivateBody["playerData"]> {
    const userIds = [
        ...new Set(players.map((p) => p.userId).filter((id) => id !== null)),
    ];

    let accountData: Record<
        string,
        {
            loadout: FindGamePrivateBody["playerData"][0]["loadout"];
            quests: FindGamePrivateBody["playerData"][0]["quests"];
            worldItems?: FindGamePrivateBody["playerData"][0]["worldItems"];
        }
    > = {};

    if (userIds.length) {
        const [users, quests, worldLives] = await Promise.all([
            db.select({
                userId: usersTable.id,
                loadout: usersTable.loadout,
            })
                .from(usersTable)
                .where(inArray(usersTable.id, userIds)),
            db.select({
                userId: userQuestTable.userId,
                questType: userQuestTable.questType,
            })
                .from(userQuestTable)
                .where(inArray(userQuestTable.userId, userIds))
                .orderBy(userQuestTable.userId, userQuestTable.idx),
            options.world
                ? db.select({
                    userId: worldLivesTable.playerId,
                    carriedItems: worldLivesTable.carriedItems,
                })
                    .from(worldLivesTable)
                    .where(
                        and(
                            inArray(worldLivesTable.playerId, userIds),
                            eq(worldLivesTable.status, "alive"),
                        ),
                    )
                    .orderBy(desc(worldLivesTable.updatedAt))
                : Promise.resolve([]),
        ]);

        const questData = new Map<string, string[]>();
        for (const quest of quests) {
            const questList = questData.get(quest.userId);
            if (questList) {
                questList.push(quest.questType);
            } else {
                questData.set(quest.userId, [quest.questType]);
            }
        }

        const worldItemData = new Map<string, FindGamePrivateBody["playerData"][0]["worldItems"]>();
        for (const life of worldLives) {
            if (worldItemData.has(life.userId)) continue;
            if (life.carriedItems.state === "carried") {
                const snapshot = life.carriedItems.snapshot;
                worldItemData.set(life.userId, {
                    kind: snapshot.kind,
                    ownerId: snapshot.ownerId,
                    revision: snapshot.revision,
                    stacks: snapshot.stacks.map((stack) => ({ ...stack })),
                    weapons: snapshot.weapons.map((weapon) => ({ ...weapon })),
                    equipment: {
                        ...snapshot.equipment,
                        perks: [...snapshot.equipment.perks],
                    },
                });
            }
        }

        accountData = Object.fromEntries(
            users.map((user) => [
                user.userId,
                {
                    loadout: user.loadout,
                    quests: questData.get(user.userId) ?? [],
                    worldItems: worldItemData.get(user.userId),
                },
            ]),
        );
    }

    return players.map(({ token, userId, ip, worldPosition, worldHealth, worldBoost }) => ({
        token,
        userId,
        ip,
        worldPosition,
        worldHealth,
        worldBoost,
        loadout: userId ? accountData[userId]?.loadout : undefined,
        quests: userId ? (accountData[userId]?.quests ?? []) : [],
        worldItems: userId ? accountData[userId]?.worldItems : undefined,
    }));
}
