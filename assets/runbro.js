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
            daysPerWeek: Number(el("daysPerWeek").value),
            condition: {
                sleepHours: el("sleepHours").value === "" ? null : Number(el("sleepHours").value),
                restingHr: el("restingHr").value === "" ? null : Number(el("restingHr").value),
                fatigue: Number(el("fatigue").value)
            }
        };
    }

    function fillProfile(profile) {
        if (!profile) return;
        if (profile.raceName) el("raceName").value = profile.raceName;
        if (profile.raceDate) el("raceDate").value = profile.raceDate;
        if (profile.distanceKm) el("raceDistance").value = String(profile.distanceKm);
        if (profile.goalTimeSeconds) fillGoalTimeFields(profile.goalTimeSeconds);
        if (profile.daysPerWeek) el("daysPerWeek").value = String(profile.daysPerWeek);
        if (profile.condition) {
            if (profile.condition.sleepHours != null) el("sleepHours").value = profile.condition.sleepHours;
            if (profile.condition.restingHr != null) el("restingHr").value = profile.condition.restingHr;
            if (profile.condition.fatigue != null) el("fatigue").value = String(profile.condition.fatigue);
        }
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
        var sleep = healthSleep != null && Number.isFinite(healthSleep)
            ? healthSleep
            : Number(profile && profile.condition && profile.condition.sleepHours || 7);
        var fatigue = Number(profile && profile.condition && profile.condition.fatigue || 2);
        var score = 82;
        score += clamp((sleep - 7) * 6, -18, 10);
        score -= (fatigue - 2) * 8;
        if (loadRatio > 1.35) score -= Math.min(20, (loadRatio - 1.35) * 35);
        if (loadRatio < 0.55 && recent.length) score -= 5;
        var garminReadiness = health && health.trainingReadiness != null
            ? Number(health.trainingReadiness)
            : null;
        if (garminReadiness != null && Number.isFinite(garminReadiness)) {
            score = score * 0.6 + clamp(garminReadiness, 0, 100) * 0.4;
        }
        score = Math.round(clamp(score, 35, 96));
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
            points = ["Strava 연결 후 최근 90일 기록 동기화", "Garmin 기록은 Strava 자동 공유로 먼저 연결 가능", "수면과 피로도를 함께 입력하면 준비도 보정"];
        } else if (score < 60) {
            title = "오늘은 강도보다 회복을 우선해 주세요.";
            summary = "최근 부하와 입력한 컨디션을 함께 보면 강한 훈련보다 짧은 회복 조깅이나 휴식이 적합합니다.";
            points = ["예정된 인터벌은 24~48시간 뒤로 이동", "수면과 수분 섭취를 먼저 확보", "통증이 있으면 달리기를 중단"];
        } else if (loadRatio > 1.3) {
            title = "훈련량이 빠르게 늘었습니다.";
            summary = "이번 주 거리가 지난주보다 크게 증가했습니다. 목표 페이스 훈련은 유지하되 다음 러닝의 거리나 반복 횟수를 줄이는 편이 안전합니다.";
            points = ["다음 이지런 거리를 계획보다 15~20% 축소", "강한 날 사이에 최소 하루 회복", "주간 총거리는 현 수준에서 안정화"];
        } else {
            title = "현재 흐름은 안정적입니다.";
            summary = "최근 러닝 볼륨과 컨디션이 목표 훈련을 이어갈 수 있는 범위입니다. 이번 주는 한 번의 품질 훈련과 한 번의 롱런을 중심으로 구성하세요.";
            points = [consistentWeeks + "주 연속 러닝 기준선 확보", "강한 훈련은 주 1~2회로 제한", "목표 페이스 " + formatPace((profile && profile.goalTimeSeconds) / targetDistance) + "/km 확인"];
        }
        if (health && health.sleepHours != null && Number.isFinite(Number(health.sleepHours))) {
            points[2] = "Garmin 수면 " + Number(health.sleepHours).toFixed(1) + "시간" +
                (Number.isFinite(Number(health.hrv)) ? " · HRV " + Math.round(Number(health.hrv)) : "") +
                " 반영";
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
                averagePaceSeconds: averagePace,
                predictedSeconds: prediction,
                weeklyVolumes: weeks.slice().reverse(),
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
            { type: "EASY", title: "회복 조깅", detail: "20~30분 아주 편안하게" },
            { type: "EASY", title: "이지런 " + formatDistance(baseDistance * 0.2) + "km", detail: easyPace ? formatPace(easyPace) + "/km" : "대화 가능한 강도" },
            { type: "EASY", title: "가벼운 조깅 " + formatDistance(baseDistance * 0.14) + "km", detail: "회복 강도" },
            { type: "KEY", title: phase === "BASE" ? "템포런 20분" : "목표 페이스 반복", detail: keyPace ? formatPace(keyPace) + "/km" : "RPE 7/10", key: true },
            { type: "EASY", title: "짧은 이지런", detail: "30분 이내" },
            { type: "EASY", title: "회복런 " + formatDistance(baseDistance * 0.16) + "km", detail: "아주 편안하게" },
            { type: "LONG", title: "롱런 " + formatDistance(longKm) + "km", detail: "마지막 10분만 점진 가속", key: true }
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
                rest: true
            };
        });
        if (score < 60) {
            templates[3] = { type: "REST", title: "훈련 대신 회복", detail: "컨디션 회복 후 재배치", rest: true };
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

    function renderPlan(plan) {
        if (!plan || !plan.length) {
            el("trainingPlan").innerHTML = '<p class="empty-state">목표 레이스를 저장하면 이번 주 계획이 표시됩니다.</p>';
            return;
        }
        el("trainingPlan").innerHTML = plan.map(function (day) {
            return '<article class="plan-day' + (day.key ? " is-key" : "") + (day.rest ? " is-rest" : "") + '">' +
                "<time datetime=\"" + escapeHtml(day.date) + "\">" + escapeHtml(day.weekday) + " · " + escapeHtml(day.date.slice(5)) + "</time>" +
                "<strong>" + escapeHtml(day.title) + "</strong>" +
                "<small>" + escapeHtml(day.detail) + "</small>" +
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
        ["strava", "garmin"].forEach(function (provider) {
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
        renderPlan(dashboard.plan);
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
        if (body && body.analysis && body.analysis.title) normalized.analysis = body.analysis;
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
            daysPerWeek: 4,
            condition: { sleepHours: 7, restingHr: 54, fatigue: 2 }
        };
        var dashboard = computeDashboard(profile, sampleActivities, null);
        dashboard.connections = {
            strava: { connected: false },
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
                currentGarminChallenge = "preview-challenge";
                setGarminAuthStep("mfa");
                setGarminDialogStatus("미리보기용 MFA 단계입니다. 123456을 입력해 주세요.");
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
            if (provider === "garmin") {
                openGarminDialog();
                return;
            }
            if (preview) {
                setFormStatus("미리보기에서는 실제 Strava 로그인으로 이동하지 않습니다.");
                return;
            }
            apiRequest("/oauth/" + provider + "/start", {
                method: "POST",
                body: JSON.stringify({ returnTo: "https://goyoungo.com/runbro/" })
            }).then(function (body) {
                if (!body.authorizationUrl) throw new Error("연결 주소를 받지 못했습니다.");
                window.location.assign(body.authorizationUrl);
            }).catch(function (error) {
                setFormStatus(error.message, true);
            });
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
            if (connections.strava && connections.strava.connected) {
                tasks.push(apiRequest("/sync", { method: "POST", body: "{}" }));
            }
            if (connections.garmin && connections.garmin.connected) {
                tasks.push(apiRequest("/garmin/sync", { method: "POST", body: "{}" }));
            }
            if (!tasks.length) {
                setFormStatus("먼저 Garmin Connect 또는 Strava를 연결해 주세요.", true);
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
                setFormStatus("입력한 컨디션으로 분석을 다시 계산했습니다.");
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
