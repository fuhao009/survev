import { hc } from "hono/client";
import type { PrivateRouteApp } from "../api/routes/private/private.ts";
import { Config } from "../config.ts";
import { privateFetchWithRetry } from "./privateAuth.ts";

export const apiPrivateRouter = hc<PrivateRouteApp>(
    `${Config.gameServer.apiServerUrl}/private`,
    {
        fetch: privateFetchWithRetry,
    },
);
