import { isIP } from "node:net";
import type { HttpRequest, HttpResponse } from "uWebSockets.js";
import type { z, ZodObject } from "zod";

const textDecoder = new TextDecoder();

export const uwsHelpers = {
    forbidden(res: HttpResponse): void {
        if (res.aborted) return;
        res.cork(() => {
            if (res.aborted) return;
            res.writeStatus("403 Forbidden").end("403 Forbidden");
        });
    },

    returnJson(res: HttpResponse, data: Record<string, unknown>): void {
        if (res.aborted) return;
        res.cork(() => {
            if (res.aborted) return;
            res.writeHeader("Content-Type", "application/json").end(JSON.stringify(data));
        });
    },

    async getBodyText(res: HttpResponse, bodyLimit = 1024 * 1024): Promise<string> {
        return new Promise((resolve, reject) => {
            res.collectBody(bodyLimit, (fullBody) => {
                if (res.aborted) return;

                if (!fullBody) {
                    res.writeStatus("413 Content Too Large");
                    res.write("413 Content Too Large");
                    res.end();
                    reject(new Error("Content Too Large"));
                    return;
                }

                resolve(new TextDecoder().decode(fullBody));
            });
        });
    },

    parseJsonBody<T extends ZodObject>(res: HttpResponse, validator: T, bodyText: string): z.infer<T> {
        try {
            const body = JSON.parse(bodyText);
            return validator.parse(body);
        } catch (error) {
            res.writeStatus("400 Bad Request");
            res.write("400 Bad Request");
            res.end();
            throw error;
        }
    },

    async getJsonBody<T extends ZodObject>(res: HttpResponse, validator: T): Promise<z.infer<T>> {
        return uwsHelpers.parseJsonBody(res, validator, await uwsHelpers.getBodyText(res));
    },

    /**
     * Get an IP from an uWebsockets HTTP response
     */
    getIp(res: HttpResponse, req: HttpRequest, proxyHeader?: string) {
        const ip = proxyHeader
            ? req.getHeader(proxyHeader.toLowerCase())
            : textDecoder.decode(res.getRemoteAddressAsText());

        if (!ip || isIP(ip) == 0) return undefined;
        return ip;
    },
};
