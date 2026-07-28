(function () {
    "use strict";

    var config = window.RUNBRO_CONFIG || {};
    var apiBase = String(config.apiBase || "").replace(/\/+$/, "");
    var preview = ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
        new URLSearchParams(window.location.search).has("preview");
    var currentDashboard = null;
    var currentGarminChallenge = null;
    var themeOrder = ["system", "light", "dark"];

    var sampleActivities = [
        { id: "sample-1", date: offsetIso(-2), name: "아침 이지런", distanceKm: 6.2, movingSeconds: 2207, averageHr: 142 },
        { id: "sample-2", date: offsetIso(-5), name: "한강 템포런", distanceKm: 8.4, movingSeconds: 2671, averageHr: 164 },
        { id: "sample-3", date: offsetIso(-8), name: "주말 롱런", distanceKm: 13.1, movingSeconds: 4884, averageHr: 151 },
        { id: "sample-4", date: offsetIso(-11), name: "회복 조깅", distanceKm: 5.0, movingSeconds: 1885, averageHr: 137 },
        { id: "sample-5", date: offsetIso(-16), name: "10K 빌드업", distanceKm: 10.0, movingSeconds: 3305, averageHr: 157 },
        { id: "sample-6", date: offsetIso(-22), name: "이지런", distanceKm: 7.1, movingSeconds: 2588, averageHr: 143 }
    ];

    function offsetIso(days) {
        var date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString();
    }

    function el(id) {
        return document.getElementById(id);
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatDistance(value) {
        var number = Number(value || 0);
        if (!Number.isFinite(number)) return "—";
        return (number >= 10 ? number.toFixed(1) : number.toFixed(2)).replace(/\.?0+$/, "");
    }

    function paceSeconds(activity) {
        var distance = Number(activity.distanceKm || 0);
        var seconds = Number(activity.movingSeconds || 0);
        return distance > 0 && seconds > 0 ? seconds / distance : 0;
    }

    function formatPace(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return "—′—″";
        var rounded = Math.round(seconds);
        return Math.floor(rounded / 60) + "′" + String(rounded % 60).padStart(2, "0") + "″";
    }

    function formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return "—:—:—";
        var rounded = Math.round(seconds);
        var hours = Math.floor(rounded / 3600);
        var minutes = Math.floor((rounded % 3600) / 60);
        var secs = rounded % 60;
        return [hours, minutes, secs].map(function (part) {
            return String(part).padStart(2, "0");
        }).join(":");
    }

    function formatGap(seconds) {
        if (!Number.isFinite(seconds)) return "비교 데이터 없음";
        var absolute = Math.abs(Math.round(seconds));
        var minutes = Math.floor(absolute / 60);
        var secs = absolute % 60;
        var value = (minutes ? minutes + "분 " : "") + secs + "초";
        if (absolute === 0) return "목표와 동일";
        return seconds > 0 ? value + " 느림" : value + " 빠름";
    }

    function goalTimeFromFields() {
        var hours = Number(el("goalHours").value);
        var minutes = Number(el("goalMinutes").value);
        var seconds = Number(el("goalSeconds").value);
        if (
            !Number.isInteger(hours) ||
            !Number.isInteger(minutes) ||
            !Number.isInteger(seconds) ||
            hours < 0 ||
            hours > 23 ||
            minutes < 0 ||
            minutes > 59 ||
            seconds < 0 ||
            seconds > 59
        ) {
            return null;
        }
        var total = hours * 3600 + minutes * 60 + seconds;
        return total > 0 ? total : null;
    }

    function fillGoalTimeFields(seconds) {
        var safe = Math.max(0, Math.round(Number(seconds || 0)));
        el("goalHours").value = String(Math.floor(safe / 3600));
        el("goalMinutes").value = String(Math.floor((safe % 3600) / 60));
        el("goalSeconds").value = String(safe % 60);
    }

    function getAccessToken() {
        return window.GoyoungoAuth && window.GoyoungoAuth.getAccessToken
            ? window.GoyoungoAuth.getAccessToken()
            : null;
    }

    function requireLogin(message, callback) {
        if (preview) {
            callback();
            return;
        }
        if (!window.GoyoungoAuth) {
            setFormStatus("카카오 로그인 기능을 불러오지 못했습니다.");
            return;
        }
        window.GoyoungoAuth.requestLogin(message, callback);
    }

    function apiRequest(path, options) {
        if (!apiBase) {
            return Promise.reject(Object.assign(
                new Error("RUNBRO 데이터 서버 연결을 준비 중입니다."),
                { code: "api_not_configured" }
            ));
        }
        var token = getAccessToken();
        var requestOptions = Object.assign({}, options || {});
        requestOptions.headers = Object.assign({
            "content-type": "application/json",
            "authorization": "Bearer " + token
        }, requestOptions.headers || {});
        return fetch(apiBase + path, requestOptions).then(function (response) {
            return response.text().then(function (source) {
                var body;
                try {
                    body = source ? JSON.parse(source) : {};
                } catch (error) {
                    body = {};
                }
                if (!response.ok) {
                    var requestError = new Error(body.message || "요청을 처리하지 못했습니다.");
                    requestError.status = response.status;
                    requestError.code = body.code;
                    throw requestError;
                }
                return body;
            });
        });
    }

    function setFormStatus(message, isError) {
        var node = el("formStatus");
        node.textContent = message || "";
        node.style.color = isError ? "var(--run-accent)" : "";
    }

    function profileFromForm() {
        return {
            raceName: el("raceName").value.trim(),
            raceDate: el("raceDate").value,
            distanceKm: Number(el("raceDistance").value),
            goalTimeSeconds: goalTimeFromFields(),
            daysPerWeek: Number(el("daysPerWeek").value)
        };
    }

    function fillProfile(profile) {
        if (!profile) return;
        if (profile.raceName) el("raceName").value = profile.raceName;
        if (profile.raceDate) el("raceDate").value = profile.raceDate;
        if (profile.distanceKm) el("raceDistance").value = String(profile.distanceKm);
        if (profile.goalTimeSeconds) fillGoalTimeFields(profile.goalTimeSeconds);
        if (profile.daysPerWeek) el("daysPerWeek").value = String(profile.daysPerWeek);
    }

    function computeDashboard(profile, activities, health) {
        var now = Date.now();
        var dayMs = 86400000;
        var runs = (activities || []).filter(function (activity) {
            return Number(activity.distanceKm) > 0 && Number(activity.movingSeconds) > 0;
        }).sort(function (a, b) {
            return new Date(b.date) - new Date(a.date);
        });
        var weeks = [0, 0, 0, 0];
        runs.forEach(function (activity) {
            var age = Math.floor((now - new Date(activity.date).getTime()) / dayMs);
            if (age >= 0 && age < 28) weeks[Math.min(3, Math.floor(age / 7))] += Number(activity.distanceKm);
        });
        var weekKm = weeks[0];
        var previousWeek = weeks[1];
        var recent = runs.filter(function (activity) {
            return now - new Date(activity.date).getTime() <= 28 * dayMs;
        });
        var recentDistance = recent.reduce(function (sum, activity) {
            return sum + Number(activity.distanceKm);
        }, 0);
        var recentSeconds = recent.reduce(function (sum, activity) {
            return sum + Number(activity.movingSeconds);
        }, 0);
        var heartRateRuns = recent.filter(function (activity) {
            var heartRate = Number(activity.averageHr);
            return Number.isFinite(heartRate) && heartRate >= 30 && heartRate <= 230;
        });
        var averageHeartRate = heartRateRuns.length
            ? heartRateRuns.reduce(function (sum, activity) {
                return sum + Number(activity.averageHr);
            }, 0) / heartRateRuns.length
            : null;
        var averagePace = recentDistance ? recentSeconds / recentDistance : 0;
        var bestComparable = recent.reduce(function (best, activity) {
            if (Number(activity.distanceKm) < 3) return best;
            var pace = paceSeconds(activity);
            return !best || pace < paceSeconds(best) ? activity : best;
        }, null);
        var targetDistance = Number(profile && profile.distanceKm || 10);
        var prediction = bestComparable
            ? Number(bestComparable.movingSeconds) * Math.pow(targetDistance / Number(bestComparable.distanceKm), 1.06)
            : 0;
        var loadRatio = previousWeek > 0 ? weekKm / previousWeek : 1;
        var healthSleep = health && health.sleepHours != null ? Number(health.sleepHours) : null;
        var sleep = healthSleep != null && Number.isFinite(healthSleep) ? healthSleep : null;
        var score = 80;
        if (sleep != null) score += clamp((sleep - 7) * 6, -18, 10);
        if (loadRatio > 1.35) score -= Math.min(20, (loadRatio - 1.35) * 35);
        if (loadRatio < 0.55 && recent.length) score -= 5;
        var garminReadiness = health && health.trainingReadiness != null
            ? Number(health.trainingReadiness)
            : null;
        if (garminReadiness != null && Number.isFinite(garminReadiness)) {
            score = score * 0.6 + clamp(garminReadiness, 0, 100) * 0.4;
        }
        score = Math.round(clamp(score, 35, 96));
        var targetPace = profile && profile.goalTimeSeconds
            ? Number(profile.goalTimeSeconds) / targetDistance
            : null;
        var paceGap = averagePace && targetPace ? averagePace - targetPace : null;
        var predictionGap = prediction && profile && profile.goalTimeSeconds
            ? prediction - Number(profile.goalTimeSeconds)
            : null;
        var daysToRace = profile && profile.raceDate
            ? Math.ceil((new Date(profile.raceDate + "T00:00:00").getTime() - now) / dayMs)
            : null;
        var phase = !Number.isFinite(daysToRace)
            ? "BASE"
            : daysToRace <= 14 ? "TAPER"
                : daysToRace <= 42 ? "SHARPEN"
                    : daysToRace <= 84 ? "BUILD"
                        : "BASE";
        var consistentWeeks = weeks.filter(function (value) { return value >= 5; }).length;
        var title;
        var summary;
        var points = [];
        if (!runs.length) {
            title = "첫 기록을 연결하면 기준선이 만들어집니다.";
            summary = "목표는 저장할 수 있지만, 현재 상태와 예상 기록은 최소 2~3회의 러닝 기록이 있어야 더 의미 있게 계산됩니다.";
            points = [
                "Garmin Connect를 연결하고 최근 기록을 동기화하세요.",
                "최소 2~3회의 러닝이 쌓이면 평균 페이스와 예상 기록을 계산합니다.",
                "수면·HRV·훈련 준비도는 Garmin에서 제공될 때만 회복 판단에 반영합니다.",
                "첫 주는 강도보다 일정한 빈도와 편안한 러닝 시간을 만드는 데 집중하세요.",
                "통증이나 이상 증상이 있으면 훈련을 중단하고 전문가와 상담하세요."
            ];
        } else if (score < 60) {
            title = "오늘은 강도보다 회복을 우선해 주세요.";
            summary = "최근 훈련 부하와 Garmin 회복 지표를 함께 보면 강한 훈련보다 짧은 회복 조깅이나 휴식이 적합합니다.";
            points = [
                "목표 점검 · 현재 예상 기록과 목표 기록의 차이를 무리하게 한 번에 줄이지 마세요.",
                "훈련 부하 · 예정된 인터벌이나 템포런은 24~48시간 뒤로 이동하세요.",
                "회복 상태 · 수면과 수분 섭취를 먼저 확보하고 Garmin 지표의 회복을 확인하세요.",
                "이번 주 우선순위 · 편안한 강도의 짧은 러닝과 휴식으로 일정을 재배치하세요.",
                "주의 · 통증이나 이상 증상이 있으면 달리기를 중단하고 전문가와 상담하세요."
            ];
        } else if (loadRatio > 1.3) {
            title = "훈련량이 빠르게 늘었습니다.";
            summary = "이번 주 거리가 지난주보다 크게 증가했습니다. 목표 페이스 훈련은 유지하되 다음 러닝의 거리나 반복 횟수를 줄이는 편이 안전합니다.";
            points = [
                "목표 점검 · 목표 페이스 훈련은 한 번만 유지하고 나머지는 편안한 강도로 구성하세요.",
                "훈련 부하 · 다음 이지런 거리를 계획보다 15~20% 줄이세요.",
                "회복 상태 · 강한 훈련 사이에 최소 하루의 회복일을 배치하세요.",
                "이번 주 우선순위 · 주간 총거리를 더 늘리지 말고 현재 수준에서 안정화하세요.",
                "주의 · 피로 누적이나 통증이 나타나면 핵심 훈련도 중단하고 회복을 우선하세요."
            ];
        } else {
            title = "현재 흐름은 안정적입니다.";
            summary = "최근 러닝 볼륨과 Garmin 회복 지표가 목표 훈련을 이어갈 수 있는 범위입니다. 이번 주는 한 번의 품질 훈련과 한 번의 롱런을 중심으로 구성하세요.";
            points = [
                "목표 점검 · 목표 페이스 " + formatPace(targetPace) + "/km와 현재 평균의 차이를 단계적으로 줄이세요.",
                "훈련 일관성 · 최근 4주 중 " + consistentWeeks + "주에서 5km 이상의 기준선을 확보했습니다.",
                "회복 상태 · 강한 훈련은 주 1~2회로 제한하고 사이에 쉬운 날을 두세요.",
                "이번 주 우선순위 · 한 번의 품질 훈련과 한 번의 롱런을 완수하는 데 집중하세요.",
                "주의 · 계획보다 몸의 반응이 좋지 않으면 거리와 반복 횟수를 즉시 줄이세요."
            ];
        }
        if (health && health.sleepHours != null && Number.isFinite(Number(health.sleepHours))) {
            points[2] = "회복 상태 · Garmin 수면 " + Number(health.sleepHours).toFixed(1) + "시간" +
                (Number.isFinite(Number(health.hrv)) ? " · HRV " + Math.round(Number(health.hrv)) : "") +
                "를 준비도 판단에 반영했습니다.";
        }
        return {
            profile: profile,
            activities: runs,
            health: health || null,
            metrics: {
                readinessScore: score,
                readinessLabel: score >= 80 ? "훈련 진행 가능" : score >= 65 ? "강도 조절 권장" : "회복 우선",
                weekKm: weekKm,
                previousWeekKm: previousWeek,
                weekChange: previousWeek > 0 ? ((weekKm - previousWeek) / previousWeek) * 100 : null,
                loadRatio: loadRatio,
                recentDistance28Days: recentDistance,
                runCount28Days: recent.length,
                averagePaceSeconds: averagePace,
                averageHeartRate: averageHeartRate,
                targetPaceSeconds: targetPace,
                paceGapSeconds: paceGap,
                predictedSeconds: prediction,
                predictionGapSeconds: predictionGap,
                weeklyVolumes: weeks.slice().reverse(),
                consistentWeeks: consistentWeeks,
                sleepHours: sleep,
                hrv: health && Number.isFinite(Number(health.hrv)) ? Number(health.hrv) : null,
                restingHr: health && Number.isFinite(Number(health.restingHr)) ? Number(health.restingHr) : null,
                garminReadiness: garminReadiness,
                phase: phase,
                daysToRace: daysToRace
            },
            analysis: {
                title: title,
                summary: summary,
                points: points
            },
            plan: buildPlan(profile, weekKm, phase, score)
        };
    }

    function buildPlan(profile, weekKm, phase, score) {
        if (!profile || !profile.raceDate) return [];
        var days = Number(profile.daysPerWeek || 4);
        var baseDistance = Math.max(15, weekKm || Number(profile.distanceKm || 10) * 2.4);
        var targetPace = profile.goalTimeSeconds
            ? profile.goalTimeSeconds / Number(profile.distanceKm)
            : null;
        var easyPace = targetPace ? targetPace + 65 : null;
        var keyPace = targetPace ? Math.max(210, targetPace - (phase === "SHARPEN" ? 5 : -10)) : null;
        var longKm = Math.max(Number(profile.distanceKm) * (phase === "TAPER" ? 0.45 : 0.72), baseDistance * 0.34);
        var trainingTemplates = [
            {
                type: "EASY", title: "회복 조깅", detail: "20~30분 아주 편안하게",
                duration: "20~30분", effort: "RPE 2~3", purpose: "회복 촉진",
                note: "호흡이 편안한 범위를 유지하고 피로가 남으면 걷기로 대체하세요.", distanceKm: 3.5
            },
            {
                type: "EASY", title: "이지런 " + formatDistance(baseDistance * 0.2) + "km",
                detail: easyPace ? formatPace(easyPace) + "/km 전후" : "대화 가능한 강도",
                duration: "35~50분", effort: "RPE 3~4", purpose: "유산소 기반",
                note: "처음 10분은 천천히 시작하고 마지막까지 같은 호흡을 유지하세요.",
                distanceKm: baseDistance * 0.2
            },
            {
                type: "EASY", title: "가벼운 조깅 " + formatDistance(baseDistance * 0.14) + "km",
                detail: "회복 강도", duration: "25~35분", effort: "RPE 2~3", purpose: "피로 관리",
                note: "다리가 무거우면 러닝 대신 가벼운 걷기와 스트레칭으로 바꾸세요.",
                distanceKm: baseDistance * 0.14
            },
            {
                type: "KEY", title: phase === "BASE" ? "템포런 20분" : "목표 페이스 반복",
                detail: keyPace ? formatPace(keyPace) + "/km 전후" : "RPE 7/10",
                duration: "워밍업 포함 50~65분", effort: "RPE 6~7", purpose: "목표 페이스 적응",
                note: phase === "BASE"
                    ? "워밍업 15분 뒤 10분 템포 2회, 세트 사이 3분 조깅으로 진행하세요."
                    : "워밍업 후 목표 페이스 구간을 짧게 반복하고 자세가 무너지기 전에 종료하세요.",
                distanceKm: baseDistance * 0.24, key: true
            },
            {
                type: "EASY", title: "짧은 이지런", detail: "30분 이내",
                duration: "20~30분", effort: "RPE 3", purpose: "빈도 유지",
                note: "기록보다 리듬에 집중하고 강한 가속은 생략하세요.", distanceKm: baseDistance * 0.12
            },
            {
                type: "EASY", title: "회복런 " + formatDistance(baseDistance * 0.16) + "km",
                detail: "아주 편안하게", duration: "30~40분", effort: "RPE 2~3", purpose: "롱런 준비",
                note: "다음 날 롱런을 위해 평소 이지 페이스보다 느리게 마치세요.",
                distanceKm: baseDistance * 0.16
            },
            {
                type: "LONG", title: "롱런 " + formatDistance(longKm) + "km",
                detail: "마지막 10분만 점진 가속", duration: "70~110분", effort: "RPE 4~5", purpose: "지구력 강화",
                note: "초반 속도를 억제하고 수분 섭취를 준비하세요. 통증이 생기면 즉시 종료하세요.",
                distanceKm: longKm, key: true
            }
        ];
        var activeDaysByCount = {
            1: [6],
            2: [3, 6],
            3: [1, 3, 6],
            4: [1, 3, 5, 6],
            5: [1, 2, 3, 5, 6],
            6: [0, 1, 2, 3, 5, 6],
            7: [0, 1, 2, 3, 4, 5, 6]
        };
        var activeDays = activeDaysByCount[clamp(days, 1, 7)] || activeDaysByCount[4];
        var templates = trainingTemplates.map(function (template, index) {
            if (activeDays.includes(index)) return template;
            return {
                type: "REST",
                title: index === 2 ? "회복 또는 근력" : "완전 휴식",
                detail: index === 2 ? "코어 20분" : "가벼운 스트레칭",
                duration: index === 2 ? "15~25분" : "10분 이내",
                effort: "RPE 1~2",
                purpose: index === 2 ? "자세 안정" : "회복",
                note: index === 2
                    ? "통증 없는 범위에서 코어와 둔근 위주로 가볍게 진행하세요."
                    : "수면과 식사를 우선하고 가벼운 관절 움직임만 유지하세요.",
                distanceKm: 0,
                rest: true
            };
        });
        if (score < 60) {
            templates[3] = {
                type: "REST", title: "훈련 대신 회복", detail: "컨디션 회복 후 재배치",
                duration: "20분 이내", effort: "RPE 1~2", purpose: "회복 우선",
                note: "Garmin 준비도와 수면이 회복된 뒤 핵심 훈련을 다음 주기로 옮기세요.",
                distanceKm: 0, rest: true
            };
        }
        var monday = new Date();
        var weekday = monday.getDay();
        monday.setDate(monday.getDate() - ((weekday + 6) % 7));
        return templates.map(function (item, index) {
            var date = new Date(monday);
            date.setDate(monday.getDate() + index);
            return Object.assign({}, item, {
                date: date.toISOString().slice(0, 10),
                weekday: ["월", "화", "수", "목", "금", "토", "일"][index]
            });
        });
    }

    function renderHero(profile, metrics) {
        if (!profile || !profile.raceDate) {
            el("heroDays").textContent = "D−---";
            el("heroRace").textContent = "목표 레이스를 설정해 주세요";
            el("heroDistance").textContent = "— KM";
            el("heroDate").textContent = "날짜와 거리를 정하면 계획이 시작됩니다.";
            el("goalState").textContent = "미설정";
            return;
        }
        var days = metrics && metrics.daysToRace;
        el("heroDays").textContent = Number.isFinite(days) ? (days >= 0 ? "D−" + days : "FINISH") : "D−---";
        el("heroRace").textContent = profile.raceName;
        el("heroDistance").textContent = formatDistance(profile.distanceKm) + " KM";
        el("heroDate").textContent = profile.raceDate + " · 목표 " + formatDuration(profile.goalTimeSeconds);
        el("goalState").textContent = "설정 완료";
    }

    function renderMetrics(dashboard) {
        var metrics = dashboard.metrics || {};
        el("readinessScore").textContent = metrics.readinessScore == null ? "—" : metrics.readinessScore;
        el("readinessLabel").textContent = metrics.readinessLabel || "기록을 연결하면 계산됩니다.";
        el("weekKm").textContent = metrics.weekKm == null ? "— km" : formatDistance(metrics.weekKm) + " km";
        el("weekChange").textContent = metrics.weekChange == null
            ? "이전 주 대비 —"
            : "이전 주 대비 " + (metrics.weekChange >= 0 ? "+" : "") + Math.round(metrics.weekChange) + "%";
        el("averagePace").textContent = formatPace(metrics.averagePaceSeconds);
        el("prediction").textContent = formatDuration(metrics.predictedSeconds);
        el("predictionDistance").textContent = dashboard.profile
            ? formatDistance(dashboard.profile.distanceKm) + "km 기준"
            : "목표 거리 기준";
        el("planPhase").textContent = metrics.phase || "BASE";
        renderVolume(metrics.weeklyVolumes || [0, 0, 0, 0]);
        renderStatusBreakdown(dashboard);
    }

    function renderStatusBreakdown(dashboard) {
        var metrics = dashboard.metrics || {};
        var healthAvailable = metrics.sleepHours != null ||
            metrics.hrv != null ||
            metrics.garminReadiness != null;
        var loadLabel = metrics.loadRatio > 1.35
            ? "빠른 증가"
            : metrics.loadRatio < 0.65 ? "부하 감소" : "안정 범위";
        var recoveryValue = metrics.garminReadiness != null
            ? Math.round(metrics.garminReadiness) + "/100"
            : metrics.sleepHours != null ? Number(metrics.sleepHours).toFixed(1) + "시간" : "데이터 없음";
        var recoveryDetail = healthAvailable
            ? [
                metrics.sleepHours != null ? "수면 " + Number(metrics.sleepHours).toFixed(1) + "시간" : null,
                metrics.hrv != null ? "HRV " + Math.round(metrics.hrv) : null,
                metrics.restingHr != null ? "안정 심박 " + Math.round(metrics.restingHr) + "bpm" : null
            ].filter(Boolean).join(" · ")
            : "Garmin 건강 지표가 제공되면 표시됩니다.";
        var cards = [
            {
                label: "목표 페이스",
                value: formatPace(metrics.targetPaceSeconds) + "/km",
                detail: "현재 평균 대비 " + formatGap(metrics.paceGapSeconds)
            },
            {
                label: "최근 28일",
                value: formatDistance(metrics.recentDistance28Days) + " km",
                detail: (metrics.runCount28Days || 0) + "회 러닝 · 일관성 " + (metrics.consistentWeeks || 0) + "/4주"
            },
            {
                label: "주간 부하 균형",
                value: loadLabel,
                detail: "이번 주/이전 주 " + (Number.isFinite(metrics.loadRatio) ? metrics.loadRatio.toFixed(2) : "—") + "배"
            },
            {
                label: "평균 심박",
                value: metrics.averageHeartRate == null ? "— bpm" : Math.round(metrics.averageHeartRate) + " bpm",
                detail: "최근 28일 심박이 기록된 러닝 기준"
            },
            {
                label: "Garmin 회복",
                value: recoveryValue,
                detail: recoveryDetail
            },
            {
                label: "목표 기록 차이",
                value: formatGap(metrics.predictionGapSeconds),
                detail: "최근 비교 가능한 러닝으로 계산한 예상 기록 기준"
            }
        ];
        el("statusBreakdown").innerHTML = cards.map(function (card) {
            return '<article class="status-detail-card">' +
                "<span>" + escapeHtml(card.label) + "</span>" +
                "<strong>" + escapeHtml(card.value) + "</strong>" +
                "<small>" + escapeHtml(card.detail) + "</small>" +
                "</article>";
        }).join("");
    }

    function renderVolume(volumes) {
        var max = Math.max.apply(Math, volumes.concat([1]));
        el("volumeBars").innerHTML = volumes.map(function (value, index) {
            var height = Math.max(8, Math.round((Number(value) / max) * 92));
            var label = index === volumes.length - 1 ? "이번 주" : (volumes.length - index) + "주 전";
            return '<div class="volume-bar" style="height:' + height + 'px">' +
                "<span>" + formatDistance(value) + "</span>" +
                "<small>" + label + "</small>" +
                "</div>";
        }).join("");
    }

    function renderAnalysis(analysis) {
        el("analysisTitle").textContent = analysis && analysis.title || "목표와 기록을 연결해 주세요.";
        el("analysisSummary").textContent = analysis && analysis.summary ||
            "최근 훈련량, 페이스 변화, 회복 정보를 함께 비교해 오늘의 상태와 다음 훈련 방향을 제안합니다.";
        el("analysisPoints").innerHTML = (analysis && analysis.points || []).map(function (point) {
            return "<li>" + escapeHtml(point) + "</li>";
        }).join("");
        var verification = analysis && analysis.verification;
        var badge = el("analysisVerification");
        if (!verification || !verification.status) {
            badge.hidden = true;
            badge.textContent = "";
            badge.removeAttribute("title");
            return;
        }
        badge.hidden = false;
        badge.classList.toggle("is-adjusted", verification.verdict === "adjusted");
        badge.classList.toggle("is-single", verification.status !== "cross_checked");
        badge.textContent = verification.status === "cross_checked"
            ? "GEMINI 3.6 FLASH × GPT-5.6 SOL"
            : "단일 모델 분석";
        badge.title = verification.note || "";
    }

    function renderAnalysisEvidence(dashboard) {
        var metrics = dashboard.metrics || {};
        var profile = dashboard.profile;
        var volumes = metrics.weeklyVolumes || [];
        var recoverySources = [
            metrics.sleepHours != null ? "수면" : null,
            metrics.hrv != null ? "HRV" : null,
            metrics.garminReadiness != null ? "훈련 준비도" : null
        ].filter(Boolean);
        var evidence = [
            {
                label: "기록 범위",
                value: (metrics.runCount28Days || 0) + "회 · " +
                    formatDistance(metrics.recentDistance28Days) + "km",
                detail: "최근 28일 러닝을 기준으로 평균 페이스와 부하를 계산했습니다."
            },
            {
                label: "4주 거리 변화",
                value: volumes.map(function (value) { return formatDistance(value); }).join(" → ") + " km",
                detail: "오래된 주부터 이번 주까지의 순서입니다."
            },
            {
                label: "목표 기준",
                value: profile
                    ? formatDistance(profile.distanceKm) + "km · " + formatDuration(profile.goalTimeSeconds)
                    : "목표 미설정",
                detail: Number.isFinite(metrics.daysToRace)
                    ? "레이스까지 " + Math.max(0, metrics.daysToRace) + "일 남았습니다."
                    : "날짜와 목표 기록을 입력하면 차이를 계산합니다."
            },
            {
                label: "회복 근거",
                value: recoverySources.length ? recoverySources.join(" · ") : "활동 기록 중심",
                detail: recoverySources.length
                    ? "Garmin이 제공한 최신 건강 요약을 함께 반영했습니다."
                    : "건강 지표가 없어 러닝 거리와 페이스 변화만 반영했습니다."
            }
        ];
        el("analysisEvidence").innerHTML =
            '<p class="evidence-title">분석에 사용한 근거</p>' +
            evidence.map(function (item) {
                return '<article class="evidence-row">' +
                    "<span>" + escapeHtml(item.label) + "</span>" +
                    "<strong>" + escapeHtml(item.value) + "</strong>" +
                    "<small>" + escapeHtml(item.detail) + "</small>" +
                    "</article>";
            }).join("");
    }

    function renderPlan(plan, metrics) {
        if (!plan || !plan.length) {
            el("planOverview").innerHTML = "";
            el("trainingPlan").innerHTML = '<p class="empty-state">목표 레이스를 저장하면 이번 주 계획이 표시됩니다.</p>';
            return;
        }
        var active = plan.filter(function (day) { return !day.rest; });
        var keySessions = plan.filter(function (day) { return day.key; });
        var plannedKm = active.reduce(function (sum, day) {
            return sum + Number(day.distanceKm || 0);
        }, 0);
        var phaseCopy = {
            BASE: "주간 빈도와 편안한 러닝으로 유산소 기반을 만드는 단계",
            BUILD: "거리와 품질 훈련을 점진적으로 늘리는 단계",
            SHARPEN: "목표 페이스 적응과 레이스 특이성을 높이는 단계",
            TAPER: "훈련량을 줄이고 피로를 회복하는 단계"
        }[metrics && metrics.phase] || "현재 기록에 맞춰 훈련 균형을 조절하는 단계";
        el("planOverview").innerHTML =
            '<article><span>예상 주간 거리</span><strong>' + formatDistance(plannedKm) + ' km</strong></article>' +
            '<article><span>러닝 / 핵심 세션</span><strong>' + active.length + '회 / ' + keySessions.length + '회</strong></article>' +
            '<article class="plan-phase-copy"><span>현재 단계</span><strong>' +
            escapeHtml(metrics && metrics.phase || "BASE") + '</strong><small>' +
            escapeHtml(phaseCopy) + '</small></article>';
        el("trainingPlan").innerHTML = plan.map(function (day) {
            return '<article class="plan-day' + (day.key ? " is-key" : "") + (day.rest ? " is-rest" : "") + '">' +
                '<div class="plan-day-head"><time datetime="' + escapeHtml(day.date) + '">' +
                escapeHtml(day.weekday) + " · " + escapeHtml(day.date.slice(5)) + "</time>" +
                '<span class="plan-type">' + escapeHtml(day.type) + "</span></div>" +
                "<strong>" + escapeHtml(day.title) + "</strong>" +
                '<p class="plan-target">' + escapeHtml(day.detail) + "</p>" +
                '<div class="plan-meta"><span>' + escapeHtml(day.duration) + "</span><span>" +
                escapeHtml(day.effort) + "</span><span>" + escapeHtml(day.purpose) + "</span></div>" +
                '<small class="plan-note">' + escapeHtml(day.note) + "</small>" +
                "</article>";
        }).join("");
    }

    function renderActivities(activities) {
        var runs = activities || [];
        el("activityCount").textContent = runs.length + " RUNS";
        if (!runs.length) {
            el("activityRows").innerHTML = '<tr><td colspan="5" class="empty-cell">연결된 기록이 없습니다.</td></tr>';
            return;
        }
        el("activityRows").innerHTML = runs.slice(0, 8).map(function (activity) {
            return "<tr>" +
                "<td>" + escapeHtml(String(activity.date).slice(0, 10)) + "</td>" +
                '<td class="activity-name">' + escapeHtml(activity.name || "러닝") + "</td>" +
                "<td>" + formatDistance(activity.distanceKm) + "km</td>" +
                "<td>" + formatPace(paceSeconds(activity)) + "</td>" +
                "<td>" + (activity.averageHr ? Math.round(activity.averageHr) + " bpm" : "—") + "</td>" +
                "</tr>";
        }).join("");
    }

    function renderConnections(connections) {
        ["garmin"].forEach(function (provider) {
            var connected = connections && connections[provider] && connections[provider].connected;
            var status = el(provider + "Status");
            var button = document.querySelector('[data-provider="' + provider + '"]');
            if (connected) {
                status.textContent = "연결됨 · " + (connections[provider].lastSyncAt
                    ? String(connections[provider].lastSyncAt).slice(0, 10) + " 동기화"
                    : "동기화 대기");
                button.textContent = "연결됨";
                button.dataset.connected = "true";
            } else {
                status.textContent = "연결되지 않음";
                button.textContent = "연결";
                button.dataset.connected = "false";
            }
        });
    }

    function renderDashboard(dashboard) {
        currentDashboard = dashboard;
        fillProfile(dashboard.profile);
        renderHero(dashboard.profile, dashboard.metrics);
        renderMetrics(dashboard);
        renderAnalysis(dashboard.analysis);
        renderAnalysisEvidence(dashboard);
        renderPlan(dashboard.plan, dashboard.metrics || {});
        renderActivities(dashboard.activities);
        renderConnections(dashboard.connections || {});
    }

    function normalizeDashboard(body) {
        if (body && body.metrics && body.plan) return body;
        var normalized = computeDashboard(
            body && body.profile,
            body && body.activities || [],
            body && body.health
        );
        normalized.connections = body && body.connections || {};
        if (body && body.analysis && body.analysis.title) {
            var storedAnalysis = Object.assign({}, body.analysis);
            var storedPoints = Array.isArray(storedAnalysis.points)
                ? storedAnalysis.points.slice(0, 5)
                : [];
            storedAnalysis.points = storedPoints.concat(
                normalized.analysis.points.slice(storedPoints.length)
            ).slice(0, 5);
            normalized.analysis = storedAnalysis;
        }
        return normalized;
    }

    function sampleDashboard() {
        var date = new Date();
        date.setDate(date.getDate() + 74);
        var profile = {
            raceName: "RUNBRO 10K CHALLENGE",
            raceDate: date.toISOString().slice(0, 10),
            distanceKm: 10,
            goalTimeSeconds: 3300,
            daysPerWeek: 4
        };
        var dashboard = computeDashboard(profile, sampleActivities, null);
        dashboard.connections = {
            garmin: { connected: false }
        };
        return dashboard;
    }

    function emptyGarminDashboard() {
        return {
            activities: [],
            health: null,
            connections: { garmin: { connected: false, lastSyncAt: null } }
        };
    }

    function fetchGarminDashboard() {
        return apiRequest("/garmin/dashboard", { method: "GET" }).catch(function (error) {
            if (error.status === 404 || error.code === "not_found") return emptyGarminDashboard();
            throw error;
        });
    }

    function mergeProviderDashboards(base, garmin) {
        var merged = Object.assign({}, base || {});
        var activities = []
            .concat(base && base.activities || [])
            .concat(garmin && garmin.activities || []);
        var seen = new Set();
        merged.activities = activities.filter(function (activity) {
            var key = String(activity.provider || "unknown") + ":" + String(activity.id || "");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        merged.connections = Object.assign(
            {},
            base && base.connections || {},
            garmin && garmin.connections || {}
        );
        merged.health = garmin && garmin.health || null;
        return merged;
    }

    function analysisInputForDashboard(dashboard) {
        var now = Date.now();
        var dayMs = 86400000;
        var weeks = [0, 0, 0, 0];
        var totalDistance = 0;
        var totalSeconds = 0;
        var totalHeartRate = 0;
        var heartRateCount = 0;
        var runCount = 0;
        (dashboard && dashboard.activities || []).forEach(function (activity) {
            var distance = Number(activity.distanceKm);
            var seconds = Number(activity.movingSeconds);
            var age = Math.floor((now - new Date(activity.date).getTime()) / dayMs);
            if (
                age < 0 ||
                age >= 28 ||
                !Number.isFinite(distance) ||
                !Number.isFinite(seconds) ||
                distance <= 0 ||
                seconds <= 0
            ) return;
            weeks[Math.min(3, Math.floor(age / 7))] += distance;
            totalDistance += distance;
            totalSeconds += seconds;
            runCount += 1;
            var heartRate = Number(activity.averageHr);
            if (Number.isFinite(heartRate) && heartRate >= 30 && heartRate <= 230) {
                totalHeartRate += heartRate;
                heartRateCount += 1;
            }
        });
        var health = dashboard && dashboard.health || {};
        function optionalNumber(value) {
            var number = Number(value);
            return value == null || value === "" || !Number.isFinite(number) ? null : number;
        }
        return {
            runCount28Days: runCount,
            weeklyDistanceKmOldestToNewest: weeks.slice().reverse().map(function (value) {
                return Math.round(value * 10) / 10;
            }),
            averagePaceSecondsPerKm: totalDistance
                ? Math.round(totalSeconds / totalDistance)
                : null,
            averageHeartRateBpm: heartRateCount
                ? Math.round(totalHeartRate / heartRateCount)
                : null,
            health: {
                sleepHours: optionalNumber(health.sleepHours),
                hrv: optionalNumber(health.hrv),
                restingHeartRate: optionalNumber(health.restingHr),
                trainingReadiness: optionalNumber(health.trainingReadiness)
            }
        };
    }

    function loadCombinedDashboard(baseRequest) {
        return Promise.all([baseRequest, fetchGarminDashboard()]).then(function (values) {
            var dashboard = normalizeDashboard(mergeProviderDashboards(values[0], values[1]));
            renderDashboard(dashboard);
            return dashboard;
        });
    }

    function loadAnalyzedDashboard() {
        var garminDashboard;
        return Promise.all([
            apiRequest("/dashboard", { method: "GET" }),
            fetchGarminDashboard()
        ]).then(function (values) {
            garminDashboard = values[1];
            var combined = mergeProviderDashboards(values[0], garminDashboard);
            return apiRequest("/analyze", {
                method: "POST",
                body: JSON.stringify({
                    analysisInput: analysisInputForDashboard(combined)
                })
            });
        }).then(function (analyzed) {
            var dashboard = normalizeDashboard(
                mergeProviderDashboards(analyzed, garminDashboard)
            );
            renderDashboard(dashboard);
            return dashboard;
        });
    }

    function loadDashboard() {
        if (preview) {
            renderDashboard(sampleDashboard());
            setFormStatus("미리보기용 예시 기록을 표시하고 있습니다.");
            return Promise.resolve();
        }
        if (!getAccessToken()) {
            renderDashboard(computeDashboard(null, []));
            return Promise.resolve();
        }
        return loadCombinedDashboard(apiRequest("/dashboard", { method: "GET" })).then(function (dashboard) {
            setFormStatus("");
            return dashboard;
        }).catch(function (error) {
            if (error.status === 401 && window.GoyoungoAuth) {
                window.GoyoungoAuth.invalidateSession();
            }
            renderDashboard(computeDashboard(null, []));
            setFormStatus(error.message, true);
        });
    }

    function saveProfile(event) {
        event.preventDefault();
        var profile = profileFromForm();
        if (!profile.raceName || !profile.raceDate || !profile.distanceKm) {
            setFormStatus("레이스 이름, 날짜, 거리를 확인해 주세요.", true);
            return;
        }
        if (!profile.goalTimeSeconds || profile.goalTimeSeconds < 300 || profile.goalTimeSeconds >= 86400) {
            setFormStatus("목표 기록을 시간·분·초로 정확하게 입력해 주세요.", true);
            return;
        }
        if (new Date(profile.raceDate + "T23:59:59").getTime() < Date.now()) {
            setFormStatus("오늘 이후의 레이스 날짜를 선택해 주세요.", true);
            return;
        }
        requireLogin("개인 목표와 분석 결과를 안전하게 저장하려면 카카오 로그인이 필요합니다.", function () {
            setFormStatus("목표와 기록을 분석하고 있습니다.");
            if (preview) {
                var dashboard = computeDashboard(profile, sampleActivities);
                dashboard.connections = sampleDashboard().connections;
                renderDashboard(dashboard);
                setFormStatus("미리보기에서 목표를 반영했습니다.");
                return;
            }
            apiRequest("/profile", {
                method: "PUT",
                body: JSON.stringify(profile)
            }).then(function () {
                return loadAnalyzedDashboard();
            }).then(function () {
                setFormStatus("목표와 이번 주 훈련 계획을 저장했습니다.");
            }).catch(function (error) {
                setFormStatus(error.message, true);
            });
        });
    }

    function setGarminDialogStatus(message, isError) {
        var status = el("garminDialogStatus");
        status.textContent = message || "";
        status.classList.toggle("is-error", Boolean(isError));
    }

    function setGarminAuthStep(step) {
        el("garminLoginForm").hidden = step !== "login";
        el("garminMfaForm").hidden = step !== "mfa";
        setGarminDialogStatus("");
        if (step === "mfa") {
            window.setTimeout(function () { el("garminMfaCode").focus(); }, 50);
        }
    }

    function resetGarminDialog() {
        currentGarminChallenge = null;
        el("garminPassword").value = "";
        el("garminMfaCode").value = "";
        setGarminAuthStep("login");
    }

    function openGarminDialog() {
        resetGarminDialog();
        var dialog = el("garminDialog");
        if (typeof dialog.showModal === "function") {
            dialog.showModal();
        } else {
            dialog.setAttribute("open", "");
        }
        window.setTimeout(function () { el("garminEmail").focus(); }, 50);
    }

    function closeGarminDialog() {
        var dialog = el("garminDialog");
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
        resetGarminDialog();
    }

    function finishPreviewGarminConnection() {
        closeGarminDialog();
        var dashboard = sampleDashboard();
        dashboard.connections.garmin = {
            connected: true,
            lastSyncAt: new Date().toISOString()
        };
        var health = {
            sleepHours: 7.4,
            restingHr: 52,
            hrv: 61,
            trainingReadiness: 78
        };
        var connectedDashboard = computeDashboard(
            dashboard.profile,
            sampleActivities,
            health
        );
        connectedDashboard.connections = dashboard.connections;
        renderDashboard(connectedDashboard);
        setFormStatus("미리보기에서 Garmin 연결과 동기화를 완료했습니다.");
    }

    function finishGarminConnection() {
        closeGarminDialog();
        setFormStatus("Garmin 연결을 완료했습니다. 최근 기록을 가져오는 중입니다.");
        return apiRequest("/garmin/sync", { method: "POST", body: "{}" })
            .then(function () { return loadAnalyzedDashboard(); })
            .then(function () {
                setFormStatus("Garmin 러닝 기록과 신체 상태를 반영했습니다.");
            })
            .catch(function (error) {
                setFormStatus(error.message, true);
            });
    }

    function submitGarminLogin(event) {
        event.preventDefault();
        var email = el("garminEmail").value.trim();
        var password = el("garminPassword").value;
        if (!email || !password || !el("garminConsent").checked) {
            setGarminDialogStatus("이메일, 비밀번호와 확인 항목을 확인해 주세요.", true);
            return;
        }
        var button = el("garminLoginSubmit");
        button.disabled = true;
        setGarminDialogStatus("Garmin Connect에 안전하게 로그인하고 있습니다.");
        if (preview) {
            el("garminPassword").value = "";
            window.setTimeout(function () {
                button.disabled = false;
                finishPreviewGarminConnection();
            }, 350);
            return;
        }
        apiRequest("/garmin/auth/start", {
            method: "POST",
            body: JSON.stringify({ email: email, password: password })
        }).then(function (body) {
            el("garminPassword").value = "";
            if (body.needsMfa && body.challengeId) {
                currentGarminChallenge = body.challengeId;
                setGarminAuthStep("mfa");
                setGarminDialogStatus("Garmin에서 전송한 인증 코드를 입력해 주세요.");
                return;
            }
            if (!body.connected) throw new Error("Garmin 연결 상태를 확인하지 못했습니다.");
            return finishGarminConnection();
        }).catch(function (error) {
            el("garminPassword").value = "";
            setGarminDialogStatus(error.message, true);
        }).finally(function () {
            button.disabled = false;
        });
    }

    function submitGarminMfa(event) {
        event.preventDefault();
        var code = el("garminMfaCode").value.replace(/\s+/g, "");
        if (!currentGarminChallenge || !/^\d{4,10}$/.test(code)) {
            setGarminDialogStatus("Garmin 인증 코드를 확인해 주세요.", true);
            return;
        }
        var button = el("garminMfaSubmit");
        button.disabled = true;
        setGarminDialogStatus("Garmin 인증을 완료하고 있습니다.");
        if (preview) {
            window.setTimeout(function () {
                button.disabled = false;
                finishPreviewGarminConnection();
            }, 350);
            return;
        }
        apiRequest("/garmin/auth/complete", {
            method: "POST",
            body: JSON.stringify({
                challengeId: currentGarminChallenge,
                code: code
            })
        }).then(function (body) {
            if (!body.connected) throw new Error("Garmin 연결 상태를 확인하지 못했습니다.");
            return finishGarminConnection();
        }).catch(function (error) {
            setGarminDialogStatus(error.message, true);
        }).finally(function () {
            button.disabled = false;
        });
    }

    function connectProvider(provider) {
        requireLogin(provider.toUpperCase() + " 기록을 연결하려면 카카오 로그인이 필요합니다.", function () {
            if (provider !== "garmin") return;
            openGarminDialog();
        });
    }

    function syncActivities() {
        requireLogin("최신 러닝 기록을 동기화하려면 카카오 로그인이 필요합니다.", function () {
            if (preview) {
                setFormStatus("미리보기 기록을 최신 상태로 표시했습니다.");
                return;
            }
            var connections = currentDashboard && currentDashboard.connections || {};
            var tasks = [];
            if (connections.garmin && connections.garmin.connected) {
                tasks.push(apiRequest("/garmin/sync", { method: "POST", body: "{}" }));
            }
            if (!tasks.length) {
                setFormStatus("먼저 Garmin Connect를 연결해 주세요.", true);
                return;
            }
            setFormStatus("최신 러닝 기록을 가져오는 중입니다.");
            Promise.all(tasks).then(function () {
                return loadAnalyzedDashboard();
            }).then(function () {
                setFormStatus("최신 러닝 기록과 분석을 반영했습니다.");
            }).catch(function (error) {
                setFormStatus(error.message, true);
            });
        });
    }

    function refreshAnalysis() {
        requireLogin("개인 기록을 다시 분석하려면 카카오 로그인이 필요합니다.", function () {
            if (preview) {
                renderDashboard(computeDashboard(
                    profileFromForm(),
                    sampleActivities,
                    currentDashboard && currentDashboard.health
                ));
                setFormStatus("Garmin 기록과 목표를 기준으로 분석을 다시 계산했습니다.");
                return;
            }
            loadAnalyzedDashboard().then(function () {
                setFormStatus("현재 상태와 훈련 계획을 다시 계산했습니다.");
            }).catch(function (error) {
                setFormStatus(error.message, true);
            });
        });
    }

    function disconnectAll() {
        requireLogin("연결과 저장 기록을 삭제하려면 카카오 로그인이 필요합니다.", function () {
            if (!window.confirm("RUNBRO에 저장된 연결 정보, 러닝 기록, 분석 결과를 모두 삭제할까요?")) return;
            if (preview) {
                renderDashboard(computeDashboard(null, []));
                setFormStatus("미리보기 데이터를 초기화했습니다.");
                return;
            }
            Promise.allSettled([
                apiRequest("/account", { method: "DELETE" }),
                apiRequest("/garmin/account", { method: "DELETE" })
            ]).then(function (results) {
                var failed = results.filter(function (result) { return result.status === "rejected"; });
                if (failed.length === results.length) throw failed[0].reason;
                renderDashboard(computeDashboard(null, []));
                setFormStatus(failed.length
                    ? "일부 연결 정보 삭제를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."
                    : "RUNBRO 연결과 저장 기록을 삭제했습니다.", Boolean(failed.length));
            }).catch(function (error) {
                setFormStatus(error.message, true);
            });
        });
    }

    function initializeThemeButton() {
        function currentTheme() {
            try {
                return localStorage.getItem("goyoungo-theme") || "system";
            } catch (error) {
                return "system";
            }
        }
        function updateLabel(value) {
            el("themeLabel").textContent = { system: "시스템", light: "라이트", dark: "다크" }[value] || "시스템";
        }
        updateLabel(currentTheme());
        el("themeButton").addEventListener("click", function () {
            var current = currentTheme();
            var next = themeOrder[(themeOrder.indexOf(current) + 1) % themeOrder.length];
            try {
                localStorage.setItem("goyoungo-theme", next);
            } catch (error) {
                next = "system";
            }
            var resolved = next === "system"
                ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
                : next;
            document.documentElement.dataset.theme = resolved;
            document.documentElement.dataset.themeMode = next;
            document.documentElement.style.colorScheme = resolved;
            var meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute("content", resolved === "dark" ? "#171512" : "#f5f1ea");
            updateLabel(next);
        });
    }

    function initialize() {
        var tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        el("raceDate").min = tomorrow.toISOString().slice(0, 10);

        initializeThemeButton();
        el("raceForm").addEventListener("submit", saveProfile);
        el("garminLoginForm").addEventListener("submit", submitGarminLogin);
        el("garminMfaForm").addEventListener("submit", submitGarminMfa);
        el("garminDialogClose").addEventListener("click", closeGarminDialog);
        el("garminMfaRestart").addEventListener("click", resetGarminDialog);
        el("garminDialog").addEventListener("cancel", function (event) {
            event.preventDefault();
            closeGarminDialog();
        });
        document.querySelectorAll("[data-provider]").forEach(function (button) {
            button.addEventListener("click", function () {
                if (button.dataset.connected === "true") {
                    setFormStatus(button.dataset.provider.toUpperCase() + "가 이미 연결되어 있습니다.");
                    return;
                }
                connectProvider(button.dataset.provider);
            });
        });
        el("syncButton").addEventListener("click", syncActivities);
        el("refreshAnalysis").addEventListener("click", refreshAnalysis);
        el("disconnectButton").addEventListener("click", disconnectAll);

        document.addEventListener("goyoungo:authchange", function (event) {
            if (event.detail && event.detail.authenticated) loadDashboard();
        });

        var callback = new URLSearchParams(window.location.search);
        if (callback.get("connected")) {
            setFormStatus(callback.get("connected").toUpperCase() + " 연결을 완료했습니다. 최신 기록을 동기화해 주세요.");
            history.replaceState({}, document.title, "/runbro/");
        } else if (callback.get("oauth_error")) {
            setFormStatus("서비스 연결을 완료하지 못했습니다. 다시 시도해 주세요.", true);
            history.replaceState({}, document.title, "/runbro/");
        }

        loadDashboard();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
