import { Hono } from "hono";
import { databaseEnabledMiddleware, rateLimitMiddleware } from "../../auth/middleware.ts";
import { LocalRouter } from "./auth/local.ts";

export const AuthRouter = new Hono();

AuthRouter.use(databaseEnabledMiddleware);
AuthRouter.use(rateLimitMiddleware(5, 60 * 1000));

AuthRouter.route("/local", LocalRouter);
