import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const dataPath = path.join(repositoryRoot, "assets", "naver-restaurants.js");
const snapshotDate = new Date().toISOString().slice(0, 10);
const requestHeaders = {
  "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
  referer: "https://map.naver.com/",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readDataset(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: dataPath });
  return context.window.NAVER_RESTAURANTS;
}

function representativeMenus(html, naverId) {
  const match = html.match(
    /window\.__APOLLO_STATE__\s*=\s*(\{.*?\});\s*window\.__PLACE_STATE__/s,
  );
  if (!match) return [];

  const state = JSON.parse(match[1]);
  const menus = Object.values(state)
    .filter(
      (entry) =>
        entry &&
        entry.__typename === "Menu" &&
        typeof entry.name === "string" &&
        entry.name.trim() &&
        (!entry.id || String(entry.id).startsWith(`${naverId}_`)),
    )
    .sort((left, right) => {
      if (Boolean(left.recommend) !== Boolean(right.recommend)) {
        return left.recommend ? -1 : 1;
      }
      return Number(left.index ?? Number.MAX_SAFE_INTEGER) -
        Number(right.index ?? Number.MAX_SAFE_INTEGER);
    });

  const names = [];
  const seen = new Set();
  for (const menu of menus) {
    const name = menu.name.replace(/\s+/g, " ").trim();
    const key = name.toLocaleLowerCase("ko-KR");
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
    if (names.length === 5) break;
  }
  return names;
}

async function fetchMenus(naverId, attempt = 0) {
  const url = `https://m.place.naver.com/restaurant/${naverId}/menu/list`;
  const response = await fetch(url, { headers: requestHeaders, redirect: "follow" });

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await wait(1_000 * 2 ** attempt);
    return fetchMenus(naverId, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return representativeMenus(await response.text(), naverId);
}

const source = await fs.readFile(dataPath, "utf8");
const dataset = readDataset(source);
const places = Array.from(
  new Map(
    Object.values(dataset.pages)
      .flat()
      .map((place) => [String(place.naverId), place]),
  ).values(),
);
const refreshMissingOnly = process.argv.includes("--missing-only");
const placesToFetch = refreshMissingOnly
  ? places.filter((place) => !Array.isArray(place.menus) || !place.menus.length)
  : places;
const menuByPlace = new Map();
const failures = [];
let cursor = 0;
let completed = 0;

async function worker() {
  while (cursor < placesToFetch.length) {
    const place = placesToFetch[cursor];
    cursor += 1;
    try {
      menuByPlace.set(String(place.naverId), await fetchMenus(place.naverId));
    } catch (error) {
      menuByPlace.set(String(place.naverId), []);
      failures.push({
        naverId: String(place.naverId),
        name: place.name,
        reason: error.message,
      });
    }
    completed += 1;
    if (completed % 20 === 0 || completed === placesToFetch.length) {
      console.log(`메뉴 확인 ${completed}/${placesToFetch.length}`);
    }
    await wait(refreshMissingOnly ? 700 : 220);
  }
}

await Promise.all(
  Array.from({ length: refreshMissingOnly ? 1 : 3 }, () => worker()),
);

for (const pagePlaces of Object.values(dataset.pages)) {
  for (const place of pagePlaces) {
    if (menuByPlace.has(String(place.naverId))) {
      place.menus = menuByPlace.get(String(place.naverId));
    }
  }
}

const placesWithMenus = Object.values(dataset.pages)
  .flat()
  .filter((place) => Array.isArray(place.menus) && place.menus.length > 0)
  .length;
dataset.source.menuSource = {
  title: "네이버 플레이스 메뉴판",
  snapshotDate,
  placesChecked: places.length,
  placesWithMenus,
  maxMenusPerPlace: 5,
};

await fs.writeFile(
  dataPath,
  `window.NAVER_RESTAURANTS = ${JSON.stringify(dataset, null, 2)};\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      placesChecked: places.length,
      placesWithMenus,
      placesRequested: placesToFetch.length,
      placesWithoutMenus: places.length - placesWithMenus,
      failures,
    },
    null,
    2,
  ),
);
