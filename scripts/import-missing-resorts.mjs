import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const dataPath = path.join(repositoryRoot, "assets", "naver-restaurants.js");
const sourceUrl =
  "https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/" +
  "e11f7bbf34c444a99cd0297c37123374/bookmarks" +
  "?start=0&limit=5000&sort=lastUseTime&createIdNo=false";

const pageAssignments = {
  konjiam: [
    "1911135363", "31159517", "11727438", "1561283581", "2067262245",
    "37067234", "18050673", "20128398", "1101390326", "35166575",
    "18049795", "36379236", "18050259", "1528447043", "1417314194",
    "13301852",
  ],
  jisan: [
    "13573708", "13573706", "13288345", "1729534738", "116218805",
    "18514716", "1858306697", "37620545", "1060262104", "1606157558",
    "229948299", "38695562", "34818419", "1982805189", "1228200860",
    "13577036",
  ],
  o2: [
    "1076083759", "1008457815", "11851760", "15438614", "15439624",
    "35228059", "37060588", "11691779", "35161492", "11722939",
    "11851820", "15461625",
  ],
  vivaldi: [
    "38248441", "1836677781", "20601514", "31047425", "1414540354",
    "11590873",
  ],
  yangji: ["1773457234", "1960786782", "34744320", "20103498"],
  elysian: ["1606711630", "15648096", "37278349", "1931911236"],
  muju: ["37769045", "20955845", "20256405"],
  high1: ["1431333892"],
  yongpyong: ["15293378"],
};

const resortCoordinates = {
  konjiam: { latitude: 37.3372, longitude: 127.2944 },
  jisan: { latitude: 37.2172, longitude: 127.3441 },
  o2: { latitude: 37.1787, longitude: 128.9906 },
  vivaldi: { latitude: 37.6451, longitude: 127.6813 },
  yangji: { latitude: 37.2092, longitude: 127.2957 },
  elysian: { latitude: 37.8178, longitude: 127.5876 },
  muju: { latitude: 35.8910, longitude: 127.7450 },
  high1: { latitude: 37.2067, longitude: 128.8385 },
  yongpyong: { latitude: 37.6458, longitude: 128.6806 },
};

function readDataset(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: dataPath });
  return context.window.NAVER_RESTAURANTS;
}

function distanceInKilometers(left, right) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const startLatitude = radians(left.latitude);
  const endLatitude = radians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function estimatedDriveMinutes(place, pageId) {
  const distance = distanceInKilometers(
    {
      latitude: Number(place.py),
      longitude: Number(place.px),
    },
    resortCoordinates[pageId],
  );
  return Math.max(3, Math.round(distance * 1.55 + 3));
}

const configuredIds = Object.values(pageAssignments).flat();
if (configuredIds.length !== 63 || new Set(configuredIds).size !== 63) {
  throw new Error("누락 장소 배정은 중복 없이 정확히 63곳이어야 합니다.");
}

const [source, response] = await Promise.all([
  fs.readFile(dataPath, "utf8"),
  fetch(sourceUrl, {
    headers: {
      accept: "application/json",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
      referer: "https://map.naver.com/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    },
  }),
]);
if (!response.ok) {
  throw new Error(`네이버 공유 목록을 불러오지 못했습니다: HTTP ${response.status}`);
}

const dataset = readDataset(source);
const shared = await response.json();
const sharedPlaces = shared.bookmarkList || [];
const sourceById = new Map(
  sharedPlaces.map((place) => [String(place.sid), place]),
);
if (sharedPlaces.length !== 302) {
  throw new Error(`원본 장소 수가 예상과 다릅니다: ${sharedPlaces.length}/302`);
}

const existingIds = new Set(
  Object.values(dataset.pages)
    .flat()
    .map((place) => String(place.naverId)),
);
const missingSourceIds = sharedPlaces
  .map((place) => String(place.sid))
  .filter((naverId) => !existingIds.has(naverId));
const configuredIdSet = new Set(configuredIds);
const unexpectedMissing = missingSourceIds.filter(
  (naverId) => !configuredIdSet.has(naverId),
);
const alreadyImported = configuredIds.filter((naverId) =>
  existingIds.has(naverId),
);
const isInitialImport =
  missingSourceIds.length === 63 && alreadyImported.length === 0;
const isRefresh =
  missingSourceIds.length === 0 && alreadyImported.length === 63;
if ((!isInitialImport && !isRefresh) || unexpectedMissing.length) {
  throw new Error(
    JSON.stringify({
      missingSourceCount: missingSourceIds.length,
      unexpectedMissing,
      alreadyImported,
    }),
  );
}

for (const [pageId, naverIds] of Object.entries(pageAssignments)) {
  const importedPlaces = naverIds.map((naverId) => {
    const place = sourceById.get(naverId);
    if (!place) {
      throw new Error(`원본 공유 목록에서 ${naverId}를 찾지 못했습니다.`);
    }
    const existingPlace = (dataset.pages[pageId] || []).find(
      (candidate) => String(candidate.naverId) === naverId,
    );
    return {
      naverId,
      name: place.name,
      address: place.address || place.roadAddress || "",
      memo: place.memo || "",
      driveMinutes: estimatedDriveMinutes(place, pageId),
      menus: existingPlace?.menus || [],
    };
  });
  importedPlaces.sort(
    (left, right) =>
      left.driveMinutes - right.driveMinutes ||
      left.name.localeCompare(right.name, "ko-KR"),
  );
  const assignedIds = new Set(naverIds);
  dataset.pages[pageId] = [
    ...(Array.isArray(dataset.pages[pageId])
      ? dataset.pages[pageId].filter(
          (place) => !assignedIds.has(String(place.naverId)),
        )
      : []),
    ...importedPlaces,
  ];
}

dataset.source.totalSharedPlaces = sharedPlaces.length;
dataset.source.importedPlaces = Object.values(dataset.pages).flat().length;
dataset.source.menuSource = {
  title: "네이버 플레이스 메뉴판",
  snapshotDate: dataset.source.menuSource?.snapshotDate || "",
  placesChecked: 0,
  placesWithMenus: 0,
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
      sourcePlaces: sharedPlaces.length,
      newlyImported: configuredIds.length,
      sitePlaces: dataset.source.importedPlaces,
      pageCounts: Object.fromEntries(
        Object.entries(dataset.pages).map(([pageId, places]) => [
          pageId,
          places.length,
        ]),
      ),
    },
    null,
    2,
  ),
);
