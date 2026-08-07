import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import z from "zod";
import { rateLimitMiddleware, validateParams } from "../../../auth/middleware.ts";
import { db } from "../../../db/index.ts";
import { usersTable } from "../../../db/schema.ts";
import { createNewUser, generateId, sanitizeSlug, setAppDataCookie, setSessionTokenCookie } from "./authUtils.ts";

const credentialsSchema = z.object({
    mode: z.enum(["login", "register"]),
    username: z.string().trim().min(3).max(24).regex(/^[\p{L}\p{N}_.-]+$/u),
    password: z.string().min(8).max(128),
});

export const LocalRouter = new Hono();

function normalizeUsername(username: string) {
    return username.trim().toLocaleLowerCase();
}

function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

function verifyPassword(password: string, encodedHash: string) {
    const [salt, expectedHex] = encodedHash.split(":");
    if (!salt || !expectedHex) return false;

    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function setAccountCookies(userId: string, c: Parameters<typeof setSessionTokenCookie>[1]) {
    setAppDataCookie(c);
    await setSessionTokenCookie(userId, c);
}

LocalRouter.use(rateLimitMiddleware(10, 60 * 1000));
LocalRouter.post(
    "/",
    validateParams(credentialsSchema, { result: "invalid_credentials" }),
    async (c) => {
        const { mode, password, username: requestedUsername } = c.req.valid("json");
        const loginUsername = normalizeUsername(requestedUsername);
        const existingUser = await db.query.usersTable.findFirst({
            where: eq(usersTable.loginUsername, loginUsername),
        });

        if (mode === "login") {
            if (!existingUser?.passwordHash || !verifyPassword(password, existingUser.passwordHash)) {
                return c.json({ result: "invalid_credentials" }, 401);
            }
            await setAccountCookies(existingUser.id, c);
            return c.json({ result: "success" }, 200);
        }

        if (existingUser) {
            return c.json({ result: "username_taken" }, 409);
        }

        const username = requestedUsername.trim();
        let slug = sanitizeSlug(username);
        while (await db.query.usersTable.findFirst({ where: eq(usersTable.slug, slug) })) {
            slug = `${sanitizeSlug(username)}-${generateId(6)}`;
        }

        const userId = generateId(15);
        await createNewUser({
            id: userId,
            authId: `local:${loginUsername}`,
            loginUsername,
            passwordHash: hashPassword(password),
            linked: true,
            usernameSet: true,
            username,
            slug,
        });
        await setAccountCookies(userId, c);
        return c.json({ result: "success" }, 201);
    },
);
