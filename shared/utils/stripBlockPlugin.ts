// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Copyright (c) 2023 gyeongseok.seo
// copied from https://github.com/gseok/vite-plugin-strip-block

import type { Plugin } from "rolldown";
import { RolldownMagicString } from "rolldown";

interface StripBlockPluginOptions {
    start?: string;
    end?: string;
}

const escapeRe = (s: string) => s.replace(/[-[\]{}()*+?.,\\^$\\/|#]/g, "\\$&");

export const stripBlockPlugin = (options: StripBlockPluginOptions): Plugin => {
    // ref: https://github.com/jballant/webpack-strip-block
    const startEsc = escapeRe(options.start || "develblock:start");
    const endEsc = escapeRe(options.end || "develblock:end");
    const regexPatterns = [
        new RegExp(
            `\\/\\* ?${startEsc} ?\\*\\/[\\s\\S]*?\\/\\* ?${endEsc} ?\\*\\/`,
            "g",
        ),
        new RegExp(
            `<!--\\s*${startEsc}\\s*-->[\\s\\S]*?<!--\\s*${endEsc}\\s*-->`,
            "g",
        ),
    ];

    return {
        name: "vite-plugin-strip-block",
        // needed for vite
        enforce: "pre",
        transform(code, id) {
            // is not 'css, html, js, jsx, ts, tsx' file then bypass
            if (!/\.(css|html|[jt]sx?)(?:[?#].*)?$/.test(id)) {
                return null;
            }
            const s = new RolldownMagicString(code);
            let changed = false;
            for (const regexPattern of regexPatterns) {
                regexPattern.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = regexPattern.exec(code)) !== null) {
                    changed = true;
                    s.remove(match.index, match.index + match[0].length);
                }
            }
            if (!changed) {
                return null;
            }
            return {
                code: s.toString(),
                map: s.generateMap({ hires: true }).toString(),
            };
        },
    } as Plugin;
};
