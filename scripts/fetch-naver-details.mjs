import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const dataPath = path.join(repositoryRoot, "assets", "naver-restaurants.js");
const snapshotDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const requestHeaders = {
  "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
  referer: "https://map.naver.com/",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};
const dayOrder = ["월", "화", "수", "목", "금", "토", "일"];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readDataset(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: dataPath });
  return context.window.NAVER_RESTAURANTS;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function compactDayLabel(days) {
  const indexes = days
    .map((day) => dayOrder.indexOf(day))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  if (indexes.length === 7) return "매일";
  if (indexes.length === 5 && indexes.every((index, position) => index === position)) {
    return "월–금";
  }
  if (indexes.length === 2 && indexes[0] === 5 && indexes[1] === 6) return "토–일";
  if (indexes.length > 1 && indexes.every((index, position) => !position || index === indexes[position - 1] + 1)) {
    return `${dayOrder[indexes[0]]}–${dayOrder[indexes[indexes.length - 1]]}`;
  }
  return indexes.map((index) => dayOrder[index]).join("·") || days.join("·");
}

function formatWorkingHours(entry) {
  const hours = entry && entry.businessHours;
  const parts = [];
  const description = cleanText(entry && entry.description);

  if (hours && hours.start && hours.end) {
    const end = entry.showEndsNextDay ? `익일 ${hours.end}` : hours.end;
    parts.push(`${hours.start}–${end}`);
  } else if (description) {
    parts.push(description);
  } else {
    parts.push("휴무");
  }

  const breaks = Array.isArray(entry && entry.breakHours)
    ? entry.breakHours
        .filter((item) => item && item.start && item.end)
        .map((item) => `${item.start}–${item.end}`)
    : [];
  if (breaks.length) parts.push(`브레이크 ${breaks.join(", ")}`);

  const lastOrders = Array.isArray(entry && entry.lastOrderTimes)
    ? entry.lastOrderTimes.map((item) => cleanText(item && item.time)).filter(Boolean)
    : [];
  if (lastOrders.length) parts.push(`라스트오더 ${Array.from(new Set(lastOrders)).join(", ")}`);
  if (description && hours && hours.start && hours.end) parts.push(description);

  return parts.join(" · ");
}

function formatSchedule(entries) {
  if (!Array.isArray(entries) || !entries.length) return "";
  const groups = [];
  for (const day of dayOrder) {
    const entry = entries.find((item) => cleanText(item && item.day) === day);
    if (!entry) continue;
    const detail = formatWorkingHours(entry);
    const previous = groups[groups.length - 1];
    if (previous && previous.detail === detail) previous.days.push(day);
    else groups.push({ days: [day], detail });
  }
  return groups.map((group) => `${compactDayLabel(group.days)} ${group.detail}`).join(" / ");
}

function formatNewBusinessHours(groups) {
  if (!Array.isArray(groups) || !groups.length) return "";
  const formatted = groups
    .map((group) => {
      const schedule = formatSchedule(group && group.businessHours);
      const freeText = cleanText(group && group.freeText);
      const regularClosedDays = cleanText(group && group.comingRegularClosedDays);
      const details = [schedule || freeText, regularClosedDays].filter(Boolean).join(" · ");
      if (!details) return "";
      const name = cleanText(group && group.name);
      return name ? `${name}: ${details}` : details;
    })
    .filter(Boolean);
  return formatted.join(" | ");
}

function formatLegacyBusinessHours(entries) {
  if (!Array.isArray(entries) || !entries.length) return "";
  const normalized = entries.map((entry) => ({
    day: cleanText(entry && entry.day),
    businessHours: entry && !entry.isDayOff && entry.startTime && entry.endTime
      ? { start: entry.startTime, end: entry.endTime }
      : null,
    description: cleanText(entry && (entry.hourString || entry.description)),
    breakHours: [],
    lastOrderTimes: [],
    showEndsNextDay: false,
  }));
  return formatSchedule(normalized);
}

function parsePlaceDetails(html, naverId) {
  const match = html.match(
    /window\.__APOLLO_STATE__\s*=\s*(\{.*?\});\s*window\.__PLACE_STATE__/s,
  );
  if (!match) throw new Error("네이버 플레이스 데이터가 응답에 없습니다.");

  const state = JSON.parse(match[1]);
  const root = state.ROOT_QUERY || {};
  const placeDetail = Object.entries(root).find(([key]) => key.startsWith("placeDetail("))?.[1];
  if (!placeDetail) throw new Error("상세 정보 응답을 찾지 못했습니다.");

  const baseReference = placeDetail.base && placeDetail.base.__ref;
  const base = (baseReference && state[baseReference]) || state[`PlaceDetailBase:${naverId}`] || {};
  const phone = cleanText(
    (placeDetail.phoneInfo && placeDetail.phoneInfo.phone) || base.virtualPhone || base.phone,
  );
  const newHours = Object.entries(placeDetail).find(([key]) =>
    key.startsWith("newBusinessHours("),
  )?.[1];
  const legacyHours = Object.entries(placeDetail).find(([key]) =>
    key.startsWith("businessHours("),
  )?.[1];
  const hours = formatNewBusinessHours(newHours) ||
    formatLegacyBusinessHours(legacyHours) ||
    formatLegacyBusinessHours(base.openingHours);

  return { phone, hours };
}

async function fetchPlaceDetails(naverId, attempt = 0) {
  const url = `https://m.place.naver.com/restaurant/${naverId}/home`;
  const response = await fetch(url, {
    headers: requestHeaders,
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await wait(1_000 * 2 ** attempt);
    return fetchPlaceDetails(naverId, attempt + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parsePlaceDetails(await response.text(), String(naverId));
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
const selectedIdsArgument = process.argv.find((argument) => argument.startsWith("--ids="));
const selectedIds = new Set(
  selectedIdsArgument
    ? selectedIdsArgument.slice("--ids=".length).split(",").map((value) => value.trim()).filter(Boolean)
    : [],
);
const placesToFetch = selectedIds.size
  ? places.filter((place) => selectedIds.has(String(place.naverId)))
  : refreshMissingOnly
    ? places.filter((place) => !cleanText(place.phone) || !cleanText(place.hours))
    : places;
const detailsByPlace = new Map();
const failures = [];
let cursor = 0;
let completed = 0;

async function worker() {
  while (cursor < placesToFetch.length) {
    const place = placesToFetch[cursor];
    cursor += 1;
    try {
      detailsByPlace.set(String(place.naverId), await fetchPlaceDetails(place.naverId));
    } catch (error) {
      failures.push({
        naverId: String(place.naverId),
        name: place.name,
        reason: error.message,
      });
    }
    completed += 1;
    if (completed % 20 === 0 || completed === placesToFetch.length) {
      console.log(`상세 정보 확인 ${completed}/${placesToFetch.length}`);
    }
    await wait(refreshMissingOnly || selectedIds.size ? 1_000 : 450);
  }
}

await Promise.all(
  Array.from({ length: refreshMissingOnly || selectedIds.size ? 1 : 2 }, () => worker()),
);

for (const pagePlaces of Object.values(dataset.pages)) {
  for (const place of pagePlaces) {
    const details = detailsByPlace.get(String(place.naverId));
    if (!details) continue;
    if (details.phone) place.phone = details.phone;
    if (details.hours) place.hours = details.hours;
  }
}

const uniquePlaces = Array.from(
  new Map(
    Object.values(dataset.pages)
      .flat()
      .map((place) => [String(place.naverId), place]),
  ).values(),
);
const placesWithPhone = uniquePlaces.filter((place) => cleanText(place.phone)).length;
const placesWithHours = uniquePlaces.filter((place) => cleanText(place.hours)).length;
dataset.source.detailSource = {
  title: "네이버 플레이스 연락처·영업시간",
  snapshotDate,
  placesChecked: places.length,
  placesWithPhone,
  placesWithHours,
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
      placesRequested: placesToFetch.length,
      placesWithPhone,
      placesWithoutPhone: places.length - placesWithPhone,
      placesWithHours,
      placesWithoutHours: places.length - placesWithHours,
      failures,
    },
    null,
    2,
  ),
);
