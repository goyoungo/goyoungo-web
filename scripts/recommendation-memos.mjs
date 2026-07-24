export function normalizeVenueName(value) {
  const aliases = {
    고향막국수: "봉평고향막국수",
    둔내웅이네: "웅이네",
    싼타클로스버거: "싼타버거",
    한우피아: "횡성한우피아",
    화이트크로우브루잉: "화이트크로우브루잉컴퍼니",
  };
  const normalized = String(value || "")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s·,().&/+-]/g, "")
    .replace(/(본점|둔내점|봉평점|면온점|평창점|하이원점|용평리조트점)$/, "");
  return aliases[normalized] || normalized;
}

export function parseRecommendationMemo(value) {
  const recommenders = [];
  const seen = new Set();
  const attributionPattern =
    /((?:[^\s,.!?]+님(?:\s*,\s*)?)+)\s*추천(?=\s|[,.!?]|$)/g;
  const memo = String(value || "").replace(
    attributionPattern,
    (_match, attribution) => {
      for (const nameMatch of attribution.matchAll(/([^\s,.!?]+)님/g)) {
        const name = nameMatch[1].trim();
        const key = name.toLocaleLowerCase("ko-KR");
        if (name && !seen.has(key)) {
          seen.add(key);
          recommenders.push(name);
        }
      }
      return "";
    },
  );

  return {
    memo: memo
      .replace(/\s+([,.!?])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim(),
    recommenders,
  };
}

export function applyMemoRecommendations(dataset, siteData) {
  const stats = {
    placesUpdated: 0,
    attributedPeople: 0,
    existingRecommendationOverlaps: 0,
    recommendationsAdded: 0,
  };

  for (const [pageId, places] of Object.entries(dataset.pages || {})) {
    const manualItems = (siteData.pages?.[pageId]?.sections || []).flatMap(
      (section) => section.items || [],
    );
    const manualByName = new Map(
      manualItems.map((item) => [normalizeVenueName(item.name), item]),
    );

    for (const place of places) {
      const parsed = parseRecommendationMemo(place.memo);
      if (!parsed.recommenders.length) {
        if (!Number.isFinite(Number(place.memoRecommendCount))) {
          place.memoRecommendCount = 0;
        }
        continue;
      }

      const manualItem = manualByName.get(normalizeVenueName(place.name));
      const existingNames = new Set(
        (manualItem?.recommenders || []).map((name) =>
          String(name).trim().toLocaleLowerCase("ko-KR"),
        ),
      );
      const recommendationsAdded = parsed.recommenders.filter((name) => {
        const overlaps = existingNames.has(
          name.trim().toLocaleLowerCase("ko-KR"),
        );
        if (overlaps) stats.existingRecommendationOverlaps += 1;
        return !overlaps;
      }).length;

      place.memo = parsed.memo;
      place.memoRecommendCount = recommendationsAdded;
      stats.placesUpdated += 1;
      stats.attributedPeople += parsed.recommenders.length;
      stats.recommendationsAdded += recommendationsAdded;
    }
  }

  return stats;
}
