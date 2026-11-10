import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
if (path.dirname(output) !== root || path.basename(output) !== "dist") throw new Error("Unsafe build output path");
if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error("Build output must not be a symlink");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const publicDirectories = new Set(["assets", "snowbro", "runbro", "blog", ".well-known"]);
const publicFiles = new Set(["ads.txt", "robots.txt", "sitemap.xml"]);
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const isPublicDirectory = entry.isDirectory() && publicDirectories.has(entry.name);
    const isPublicFile = entry.isFile() && (publicFiles.has(entry.name) || /\.(html|ico|png|svg|webmanifest)$/.test(entry.name));
    if (!isPublicDirectory && !isPublicFile) continue;
    fs.cpSync(path.join(root, entry.name), path.join(output, entry.name), {
        recursive: true,
        filter: source => !fs.lstatSync(source).isSymbolicLink()
    });
}
if (!fs.existsSync(path.join(output, "index.html"))) throw new Error("Missing public index.html");
console.log("Prepared public-only static site in dist (server sources and tests excluded).");
