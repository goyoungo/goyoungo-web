import assert from "node:assert/strict";
import test from "node:test";
import {
    collectGeminiSse,
    normalizeGeminiAnalysis,
    validateVerifiedResult
} from "../analysis-lib.mjs";

function verifiedFixture() {
    return {
        analysis: {
            title: "훈련 일관성 우선",
            summary: "최근 추세를 유지하면서 회복과 목표 페이스 적응을 함께 확인합니다.",
            points: [
                "목표 · 현재 페이스를 기준으로 점진적으로 접근합니다.",
                "훈련량 · 주간 거리 급증을 피합니다.",
                "구성 · 쉬운 러닝과 품질 훈련의 균형을 맞춥니다.",
                "회복 · 회복 신호가 낮으면 강도를 줄입니다.",
                "우선순위 · 다음 훈련은 존2 러닝입니다."
            ]
        },
        recommendation: {
            type: "zone2",
            title: "편안한 존2 러닝",
            prescription: "말할 수 있는 강도로 40분 달립니다.",
            why: [
                "최근 훈련량을 무리 없이 이어갈 수 있습니다.",
                "다음 품질 훈련 전 회복 시간을 확보합니다."
            ],
            caution: "통증이나 어지럼증이 있으면 중단하세요."
        },
        trainingPlan: Array.from({ length: 7 }, (_, index) => ({
            date: `2026-08-${String(index + 1).padStart(2, "0")}`,
            weekday: ["토", "일", "월", "화", "수", "목", "금"][index],
            type: index % 2 ? "휴식" : "존2",
            title: index % 2 ? "휴식" : "편안한 러닝",
            detail: index % 2 ? "가벼운 스트레칭" : "편안한 강도로 달리기",
            duration: index % 2 ? "20분" : "40분",
            effort: index % 2 ? "매우 낮음" : "RPE 3",
            purpose: index % 2 ? "회복" : "유산소 기반",
            note: "컨디션이 낮으면 시간을 줄이세요.",
            distanceKm: index % 2 ? 0 : 6,
            key: index === 4,
            rest: Boolean(index % 2)
        })),
        verdict: "confirmed",
        verificationNote: "1차 분석의 방향과 기록 추세가 일치합니다."
    };
}

test("normalizes a five-point Gemini result", () => {
    const result = normalizeGeminiAnalysis({
        title: "  현재 흐름 유지  ",
        summary: "주간 거리 급증 없이 일관성을 유지하세요.",
        points: ["1", "2", "3", "4", "5"]
    });
    assert.equal(result.title, "현재 흐름 유지");
    assert.equal(result.points.length, 5);
});

test("rejects malformed Gemini output", () => {
    assert.throws(() => normalizeGeminiAnalysis({
        title: "잘못된 결과",
        summary: "근거 수가 부족합니다.",
        points: ["1", "2"]
    }));
});

test("validates a complete Codex result", () => {
    const result = validateVerifiedResult(verifiedFixture());
    assert.equal(result.recommendation.type, "zone2");
    assert.equal(result.trainingPlan.length, 7);
    assert.equal(result.verdict, "confirmed");
});

test("rejects duplicate training dates", () => {
    const fixture = verifiedFixture();
    fixture.trainingPlan[1].date = fixture.trainingPlan[0].date;
    assert.throws(() => validateVerifiedResult(fixture), /duplicate_training_date/);
});

test("rejects an unsupported recommendation type", () => {
    const fixture = verifiedFixture();
    fixture.recommendation.type = "sprint";
    assert.throws(() => validateVerifiedResult(fixture), /invalid_recommendation_type/);
});

test("collectGeminiSse joins streamed text chunks", () => {
    const source = [
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"내부 추론"},{"text":"{\\"title\\":\\"상태\\""}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":",\\"summary\\":\\"안정\\",\\"points\\":[\\"근거\\"]}"}]}}]}',
        "data: [DONE]"
    ].join("\n\n");
    assert.equal(
        collectGeminiSse(source),
        '{"title":"상태","summary":"안정","points":["근거"]}'
    );
});
