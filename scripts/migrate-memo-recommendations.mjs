import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { applyMemoRecommendations } from "./recommendation-memos.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const restaurantDataPath = path.join(
  repositoryRoot,
  "assets",
  "naver-restaurants.js",
);
const siteDataPath = path.join(repositoryRoot, "assets", "site-data.js");

function readWindowDataset(source, property, filename) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename });
  return context.window[property];
}

const [restaurantSource, siteSource] = await Promise.all([
  fs.readFile(restaurantDataPath, "utf8"),
  fs.readFile(siteDataPath, "utf8"),
]);
const dataset = readWindowDataset(
  restaurantSource,
  "NAVER_RESTAURANTS",
  restaurantDataPath,
);
const siteData = readWindowDataset(siteSource, "SITE_DATA", siteDataPath);
const stats = applyMemoRecommendations(dataset, siteData);

await fs.writeFile(
  restaurantDataPath,
  `window.NAVER_RESTAURANTS = ${JSON.stringify(dataset, null, 2)};\n`,
  "utf8",
);

console.log(JSON.stringify(stats, null, 2));
