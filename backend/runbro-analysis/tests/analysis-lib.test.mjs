import assert from "node:assert/strict";
import test from "node:test";
import {
    validateCodexResult
} from "../analysis-lib.mjs";

function codexFixture() {
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
        latestRunAnalysis: {
            runDate: "2026-07-28",
            runType: "tempo",
            title: "목표 페이스 적응을 확인한 템포런",
            summary: "평균보다 빠른 페이스를 안정적으로 유지한 훈련입니다.",
            execution: "계획한 거리에서 페이스 저하 없이 마무리했습니다.",
            intensity: "강도는 높았지만 과도한 구간으로 분류되지는 않았습니다.",
            recovery: "다음 날은 쉬운 러닝이나 휴식이 적절합니다.",
            positives: [
                "목표 페이스에 가까운 리듬을 유지했습니다.",
                "최근 평균보다 긴 시간 동안 집중했습니다."
            ],
            cautions: ["다음 품질 훈련 전 회복 시간을 확보하세요."],
            nextFocus: "초반 속도를 조금 낮추고 후반 유지력을 확인하세요."
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
        analysisNote: "최근 12주 개별 러닝과 Garmin 회복 수치를 직접 비교했습니다."
    };
}

test("validates a complete Codex result", () => {
    const result = validateCodexResult(codexFixture());
    assert.equal(result.recommendation.type, "zone2");
    assert.equal(result.latestRunAnalysis.runType, "tempo");
    assert.equal(result.trainingPlan.length, 7);
    assert.match(result.analysisNote, /12주/);
});

test("rejects duplicate training dates", () => {
    const fixture = codexFixture();
    fixture.trainingPlan[1].date = fixture.trainingPlan[0].date;
    assert.throws(() => validateCodexResult(fixture), /duplicate_training_date/);
});

test("rejects an unsupported recommendation type", () => {
    const fixture = codexFixture();
    fixture.recommendation.type = "sprint";
    assert.throws(() => validateCodexResult(fixture), /invalid_recommendation_type/);
});
