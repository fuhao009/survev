import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const scanRoots = [
    "client/dist",
    "server/dist",
];
const blockedPatterns = [
    /ui-editor/,
    /编辑模式/,
    /game-edit-mode/,
    /building-editor/,
    /EditMsg/,
    /MsgType\.Edit/,
    /processEditMsg/,
    /allowEditMsg/,
    /godMode/,
    /noClip/,
    /moveObjs/,
    /teleportToPings/,
    /preventGameStart/,
    /spawnLootType/,
    /debugTools/,
    /debugRenderer/,
    /debugHUD/,
    /buildingEditor/,
    /STRIP_FROM_PROD_CLIENT/,
    /STRIP_FROM_PROD_SERVER/,
];
const textFilePattern = /\.(?:html|css|js|json|map)$/;

function trackedGeneratedArtifacts() {
    try {
        return execFileSync("git", ["ls-files", "outputs"], {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        })
            .trim()
            .split("\n")
            .filter(Boolean);
    } catch {
        return [];
    }
}

function walk(directory, files = []) {
    let entries;
    try {
        entries = readdirSync(directory);
    } catch {
        return files;
    }

    for (const entry of entries) {
        const path = join(directory, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            walk(path, files);
        } else {
            files.push(path);
        }
    }
    return files;
}

const failures = [];
for (const file of trackedGeneratedArtifacts()) {
    failures.push(`${file}: generated validation artifacts must not be tracked`);
}

for (const root of scanRoots) {
    for (const file of walk(join(repoRoot, root))) {
        const displayPath = relative(repoRoot, file);
        if (file.endsWith(".map")) {
            failures.push(`${displayPath}: source maps must not ship in production`);
            continue;
        }
        if (!textFilePattern.test(file)) continue;

        const contents = readFileSync(file, "utf8");
        for (const pattern of blockedPatterns) {
            if (pattern.test(contents)) {
                failures.push(`${displayPath}: blocked production marker ${pattern}`);
            }
        }
    }
}

if (failures.length) {
    console.error("Production artifact check failed:");
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log("Production artifact check passed.");
