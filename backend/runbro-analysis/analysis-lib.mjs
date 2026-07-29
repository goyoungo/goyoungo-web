const RUN_TYPES = ["interval", "tempo", "zone2", "long", "recovery"];

function text(value, maxLength, fieldName) {
    const normalized = String(value || "").trim();
    if (!normalized || normalized.length > maxLength) {
        throw new Error(`invalid_${fieldName}`);
    }
    return normalized;
}

function number(value, min, max, fieldName) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < min || normalized > max) {
        throw new Error(`invalid_${fieldName}`);
    }
    return normalized;
}

function dateValue(value) {
    const normalized = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        throw new Error("invalid_training_date");
    }
    const parsed = new Date(`${normalized}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime())) {
        throw new Error("invalid_training_date");
    }
    return normalized;
}

export function normalizeGeminiAnalysis(value) {
    if (
        !value ||
        Array.isArray(value) ||
        typeof value !== "object" ||
        !Array.isArray(value.points) ||
        value.points.length !== 5
    ) {
        throw new Error("invalid_gemini_result");
    }
    return {
        title: text(value.title, 80, "gemini_title"),
        summary: text(value.summary, 520, "gemini_summary"),
        points: value.points.map((point) => text(point, 220, "gemini_point"))
    };
}

export function collectGeminiSse(source) {
    if (typeof source !== "string" || source.length > 512 * 1024) {
        throw new Error("gemini_stream_invalid");
    }
    let result = "";
    for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const chunk = JSON.parse(payload);
        for (const part of chunk.candidates?.[0]?.content?.parts || []) {
            if (part.thought !== true && typeof part.text === "string") {
                result += part.text;
            }
        }
    }
    if (!result || result.length > 5000) {
        throw new Error("gemini_empty_result");
    }
    return result;
}

export function validateVerifiedResult(value) {
    if (!value || Array.isArray(value) || typeof value !== "object") {
        throw new Error("invalid_verified_result");
    }
    const analysis = value.analysis;
    const recommendation = value.recommendation;
    const trainingPlan = value.trainingPlan;
    if (
        !analysis ||
        !recommendation ||
        !Array.isArray(analysis.points) ||
        analysis.points.length !== 5 ||
        !Array.isArray(recommendation.why) ||
        recommendation.why.length < 2 ||
        recommendation.why.length > 4 ||
        !Array.isArray(trainingPlan) ||
        trainingPlan.length !== 7
    ) {
        throw new Error("invalid_verified_result");
    }

    const seenDates = new Set();
    const normalizedPlan = trainingPlan.map((day) => {
        const date = dateValue(day && day.date);
        if (seenDates.has(date)) throw new Error("duplicate_training_date");
        seenDates.add(date);
        const distanceKm = day && day.distanceKm == null
            ? 0
            : number(day.distanceKm, 0, 100, "training_distance");
        return {
            date,
            weekday: text(day && day.weekday, 4, "weekday"),
            type: text(day && day.type, 20, "training_type"),
            title: text(day && day.title, 80, "training_title"),
            detail: text(day && day.detail, 180, "training_detail"),
            duration: text(day && day.duration, 40, "training_duration"),
            effort: text(day && day.effort, 40, "training_effort"),
            purpose: text(day && day.purpose, 100, "training_purpose"),
            note: text(day && day.note, 240, "training_note"),
            distanceKm: Math.round(distanceKm * 10) / 10,
            key: Boolean(day && day.key),
            rest: Boolean(day && day.rest)
        };
    });

    const type = text(recommendation.type, 20, "recommendation_type");
    if (!RUN_TYPES.includes(type) && type !== "rest") {
        throw new Error("invalid_recommendation_type");
    }

    return {
        analysis: {
            title: text(analysis.title, 80, "analysis_title"),
            summary: text(analysis.summary, 520, "analysis_summary"),
            points: analysis.points.map((point) =>
                text(point, 220, "analysis_point")
            )
        },
        recommendation: {
            type,
            title: text(recommendation.title, 100, "recommendation_title"),
            prescription: text(
                recommendation.prescription,
                260,
                "recommendation_prescription"
            ),
            why: recommendation.why.map((reason) =>
                text(reason, 220, "recommendation_reason")
            ),
            caution: text(
                recommendation.caution,
                240,
                "recommendation_caution"
            )
        },
        trainingPlan: normalizedPlan,
        verdict: value.verdict === "confirmed" ? "confirmed" : "adjusted",
        verificationNote: text(
            value.verificationNote,
            180,
            "verification_note"
        )
    };
}

export function safeErrorCode(error, fallback = "analysis_failed") {
    const source = String(error && error.message || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
    return source || fallback;
}

export function currentDateKst() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());
}
