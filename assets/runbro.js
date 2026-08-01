(function () {
    "use strict";

    var config = window.RUNBRO_CONFIG || {};
    var apiBase = String(config.apiBase || "").replace(/\/+$/, "");
    var preview = ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
        new URLSearchParams(window.location.search).has("preview");
    var currentDashboard = null;
    var currentGarminChallenge = null;
    var analysisPollToken = 0;
    var autoSyncStorageKey = "runbro-garmin-auto-sync-v1";
    var trendWeeks = 4;
    var calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    var themeOrder = ["system", "light", "dark"];

    var sampleActivities = [
        { id: "sample-1", date: offsetIso(-2), name: "아침 존2 러닝", distanceKm: 6.2, movingSeconds: 2207, averageHr: 142, maxHr: 156 },
        { id: "sample-2", date: offsetIso(-5), name: "한강 템포런", distanceKm: 8.4, movingSeconds: 2671, averageHr: 164, maxHr: 178 },
        { id: "sample-3", date: offsetIso(-8), name: "주말 롱런", distanceKm: 13.1, movingSeconds: 4884, averageHr: 151, maxHr: 168 },
        { id: "sample-4", date: offsetIso(-11), name: "회복 조깅", distanceKm: 5.0, movingSeconds: 1885, averageHr: 137, maxHr: 149 },
        { id: "sample-5", date: offsetIso(-16), name: "1K 인터벌 5회", distanceKm: 9.2, movingSeconds: 2860, averageHr: 169, maxHr: 186 },
        { id: "sample-6", date: offsetIso(-22), name: "이지런", distanceKm: 7.1, movingSeconds: 2588, averageHr: 143, maxHr: 158 },
        { id: "sample-7", date: offsetIso(-31), name: "주말 장거리", distanceKm: 12.0, movingSeconds: 4580, averageHr: 149, maxHr: 165 },
        { id: "sample-8", date: offsetIso(-39), name: "지속주", distanceKm: 7.5, movingSeconds: 2470, averageHr: 160, maxHr: 174 },
        { id: "sample-9", date: offsetIso(-48), name: "편안한 조깅", distanceKm: 6.0, movingSeconds: 2305, averageHr: 141, maxHr: 154 },
        { id: "sample-10", date: offsetIso(-58), name: "400m 반복", distanceKm: 7.8, movingSeconds: 2415, averageHr: 166, maxHr: 183 },
        { id: "sample-11", date: offsetIso(-68), name: "롱런", distanceKm: 11.0, movingSeconds: 4310, averageHr: 148, maxHr: 163 },
        { id: "sample-12", date: offsetIso(-78), name: "회복런", distanceKm: 4.8, movingSeconds: 1895, averageHr: 135, maxHr: 147 }
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
            hours > 240 ||
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

    var runTypeMeta = {
        interval: { label: "인터벌", short: "INTERVAL" },
        tempo: { label: "템포", short: "TEMPO" },
        zone2: { label: "존2", short: "ZONE 2" },
        long: { label: "장거리", short: "LONG" },
        recovery: { label: "회복런", short: "RECOVERY" }
    };

    function median(values) {
        var sorted = values.filter(Number.isFinite).sort(function (a, b) { return a - b; });
        if (!sorted.length) return null;
        var middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function observedMaxHeartRate(activities) {
        var values = [];
        (activities || []).forEach(function (activity) {
            var maxHr = Number(activity.maxHr);
            var averageHr = Number(activity.averageHr);
            if (Number.isFinite(maxHr) && maxHr >= 120 && maxHr <= 230) values.push(maxHr);
            else if (Number.isFinite(averageHr) && averageHr >= 110 && averageHr <= 210) {
                values.push(averageHr + 12);
            }
        });
        return values.length ? Math.round(Math.max.apply(Math, values)) : null;
    }

    function heartRateZone(activity, maxHr, restingHr) {
        var averageHr = Number(activity && activity.averageHr);
        var rest = Number(restingHr);
        if (
            !Number.isFinite(averageHr) ||
            !Number.isFinite(maxHr) ||
            maxHr < 140 ||
            averageHr < 30
        ) return null;
        if (!Number.isFinite(rest) || rest < 30 || rest >= maxHr - 50) rest = 50;
        var reserveRatio = (averageHr - rest) / (maxHr - rest);
        if (reserveRatio < 0.6) return 1;
        if (reserveRatio < 0.7) return 2;
        if (reserveRatio < 0.8) return 3;
        if (reserveRatio < 0.9) return 4;
        return 5;
    }

    function estimateVdot(activity) {
        var distanceKm = Number(activity && activity.distanceKm);
        var seconds = Number(activity && activity.movingSeconds);
        if (
            !Number.isFinite(distanceKm) ||
            !Number.isFinite(seconds) ||
            distanceKm < 1.5 ||
            distanceKm > 50 ||
            seconds < 360
        ) return null;
        var minutes = seconds / 60;
        var velocity = distanceKm * 1000 / minutes;
        var oxygenCost = -4.60 + 0.182258 * velocity + 0.000104 * velocity * velocity;
        var sustainableFraction = 0.8 +
            0.1894393 * Math.exp(-0.012778 * minutes) +
            0.2989558 * Math.exp(-0.1932605 * minutes);
        var vdot = oxygenCost / sustainableFraction;
        return Number.isFinite(vdot) && vdot >= 15 && vdot <= 90 ? vdot : null;
    }

    function classifyActivity(activity, context) {
        var name = String(activity.name || "").toLowerCase();
        var distance = Number(activity.distanceKm || 0);
        var duration = Number(activity.movingSeconds || 0);
        var pace = paceSeconds(activity);
        var zone = heartRateZone(activity, context.maxHr, context.restingHr);
        var labelRules = [
            { type: "interval", pattern: /인터벌|interval|반복|repeat|400m|800m|1k\s/ },
            { type: "tempo", pattern: /템포|tempo|threshold|역치|지속주|빌드업/ },
            { type: "long", pattern: /롱런|long|장거리|lsd/ },
            { type: "recovery", pattern: /회복|recovery|리커버리/ },
            { type: "zone2", pattern: /존\s?2|zone\s?2|이지|easy|편안|조깅/ }
        ];
        var named = labelRules.find(function (rule) { return rule.pattern.test(name); });
        if (named) return { key: named.type, confidence: "name", zone: zone };

        if (
            duration >= 3600 &&
            distance >= Math.max(9, Math.min(18, context.medianDistance * 1.55))
        ) {
            return { key: "long", confidence: "metrics", zone: zone };
        }
        if (
            (zone === 5 || (context.medianPace && pace < context.medianPace * 0.86)) &&
            distance <= 12
        ) {
            return { key: "interval", confidence: "metrics", zone: zone };
        }
        if (
            (zone === 4 || (context.medianPace && pace < context.medianPace * 0.94)) &&
            duration >= 1200 &&
            duration <= 5400
        ) {
            return { key: "tempo", confidence: "metrics", zone: zone };
        }
        if (zone === 1 || (context.medianPace && pace > context.medianPace * 1.14)) {
            return { key: "recovery", confidence: "metrics", zone: zone };
        }
        return { key: "zone2", confidence: zone === 2 ? "heart-rate" : "metrics", zone: zone };
    }

    function decorateActivities(activities, health) {
        var base = (activities || []).filter(function (activity) {
            return Number(activity.distanceKm) > 0 && Number(activity.movingSeconds) > 0;
        }).sort(function (a, b) {
            return new Date(b.date) - new Date(a.date);
        });
        var context = {
            maxHr: observedMaxHeartRate(base),
            restingHr: health && Number.isFinite(Number(health.restingHr))
                ? Number(health.restingHr)
                : 50,
            medianPace: median(base.map(paceSeconds)),
            medianDistance: median(base.map(function (activity) {
                return Number(activity.distanceKm);
            })) || 6
        };
        return base.map(function (activity) {
            var classified = classifyActivity(activity, context);
            return Object.assign({}, activity, {
                runType: classified.key,
                runTypeLabel: runTypeMeta[classified.key].label,
                classificationBasis: classified.confidence,
                heartRateZone: classified.zone,
                estimatedVdot: estimateVdot(activity)
            });
        });
    }

    function computeTrendData(activities, weeks, health) {
        var now = new Date();
        var dayMs = 86400000;
        var bucketCount = clamp(Number(weeks || 4), 4, 12);
        var buckets = Array.from({ length: bucketCount }, function (_, index) {
            return {
                offset: bucketCount - index - 1,
                distance: 0,
                vdot: null,
                runs: 0
            };
        });
        var typeTotals = { interval: 0, tempo: 0, zone2: 0, long: 0, recovery: 0 };
        var zoneSeconds = [0, 0, 0, 0, 0];
        var periodActivities = (activities || []).filter(function (activity) {
            var age = Math.floor((now.getTime() - new Date(activity.date).getTime()) / dayMs);
            return age >= 0 && age < bucketCount * 7;
        });
        periodActivities.forEach(function (activity) {
            var age = Math.floor((now.getTime() - new Date(activity.date).getTime()) / dayMs);
            var newestIndex = Math.min(bucketCount - 1, Math.floor(age / 7));
            var bucket = buckets[bucketCount - newestIndex - 1];
            bucket.distance += Number(activity.distanceKm || 0);
            bucket.runs += 1;
            var vdot = Number(activity.estimatedVdot);
            if (Number.isFinite(vdot)) bucket.vdot = Math.max(bucket.vdot || 0, vdot);
            if (typeTotals[activity.runType] != null) {
                typeTotals[activity.runType] += Number(activity.distanceKm || 0);
            }
            var zone = Number(activity.heartRateZone);
            if (zone >= 1 && zone <= 5) {
                zoneSeconds[zone - 1] += Number(activity.movingSeconds || 0);
            }
        });
        var vdotValues = buckets.map(function (bucket) { return bucket.vdot; }).filter(Number.isFinite);
        var recentVdot = vdotValues.length ? vdotValues[vdotValues.length - 1] : null;
        var firstVdot = vdotValues.length ? vdotValues[0] : null;
        var maxHr = observedMaxHeartRate(periodActivities);
        return {
            weeks: bucketCount,
            buckets: buckets,
            totalDistance: buckets.reduce(function (sum, bucket) { return sum + bucket.distance; }, 0),
            runCount: periodActivities.length,
            currentVdot: recentVdot,
            vdotChange: recentVdot != null && firstVdot != null ? recentVdot - firstVdot : null,
            maxHr: maxHr,
            restingHr: health && Number.isFinite(Number(health.restingHr))
                ? Number(health.restingHr)
                : null,
            typeTotals: typeTotals,
            zoneSeconds: zoneSeconds
        };
    }

    function suggestNextTraining(profile, activities, metrics) {
        if (!activities || !activities.length) return null;
        var now = Date.now();
        var recent = (activities || []).filter(function (activity) {
            return now - new Date(activity.date).getTime() <= 8 * 86400000;
        });
        var hasQuality = recent.some(function (activity) {
            return activity.runType === "interval" || activity.runType === "tempo";
        });
        var hasLong = recent.some(function (activity) { return activity.runType === "long"; });
        var lastRun = activities && activities[0];
        var daysSinceLast = lastRun
            ? Math.max(0, Math.floor((now - new Date(lastRun.date).getTime()) / 86400000))
            : null;
        var proposal;
        if (metrics.readinessScore < 60 || metrics.loadRatio > 1.4) {
            proposal = {
                type: "RECOVERY",
                title: "20~30분 회복런 또는 완전 휴식",
                prescription: "대화가 편한 강도 · RPE 2~3 · 가속 없이 종료",
                why: [
                    "준비도 " + metrics.readinessScore + "/100으로 강도보다 회복이 우선입니다.",
                    "이번 주 부하는 이전 주의 " + metrics.loadRatio.toFixed(2) + "배여서 추가 강도를 억제합니다.",
                    "다음 품질 훈련의 완성도를 위해 피로를 먼저 낮춥니다."
                ]
            };
        } else if (!hasQuality && metrics.phase === "SHARPEN") {
            proposal = {
                type: "INTERVAL",
                title: "목표 페이스 인터벌 4~6회",
                prescription: "워밍업 15분 · 3~5분 반복 · 반복 사이 2분 조깅",
                why: [
                    "최근 8일 동안 인터벌·템포 훈련이 없어 품질 자극을 배치할 시점입니다.",
                    "현재 단계가 SHARPEN이라 목표 페이스 적응이 우선입니다.",
                    "주간 부하가 " + metrics.loadRatio.toFixed(2) + "배로 급증 범위가 아닙니다."
                ]
            };
        } else if (!hasQuality) {
            proposal = {
                type: "TEMPO",
                title: "20분 템포런",
                prescription: "워밍업 15분 · 템포 10분×2 · 세트 사이 3분 조깅",
                why: [
                    "최근 8일 동안 품질 훈련이 없어 역치 자극을 한 번 배치합니다.",
                    "최근 평균 페이스와 목표 페이스의 차이는 " + formatGap(metrics.paceGapSeconds) + "입니다.",
                    "주간 총거리보다 지속 가능한 페이스 유지 능력을 먼저 확인합니다."
                ]
            };
        } else if (!hasLong && profile && Number(profile.distanceKm) >= 10) {
            proposal = {
                type: "LONG",
                title: "편안한 장거리 러닝",
                prescription: "예정 거리의 70~80%는 대화 가능한 강도 · 마지막 10분만 점진 가속",
                why: [
                    "최근 8일 동안 장거리 러닝이 없어 지구력 세션을 보완합니다.",
                    "목표 거리가 " + formatDistance(profile.distanceKm) + "km라 지속 시간 적응이 필요합니다.",
                    "이미 품질 훈련을 수행했으므로 속도보다 안정적인 시간을 확보합니다."
                ]
            };
        } else {
            proposal = {
                type: "ZONE 2",
                title: "35~50분 존2 러닝",
                prescription: "대화 가능한 호흡 · RPE 3~4 · 후반에도 같은 강도 유지",
                why: [
                    "최근 품질 훈련과 장거리 자극이 모두 있어 추가 강도보다 흡수가 중요합니다.",
                    "이번 주 거리 변화는 " + (metrics.weekChange == null
                        ? "비교 기준이 부족합니다."
                        : (metrics.weekChange >= 0 ? "+" : "") + Math.round(metrics.weekChange) + "%입니다."),
                    daysSinceLast == null
                        ? "첫 기록을 만들기 좋은 낮은 강도의 세션입니다."
                        : "마지막 러닝 후 " + daysSinceLast + "일이 지나 빈도를 안정적으로 이어갑니다."
                ]
            };
        }
        proposal.caution = "통증, 어지럼, 비정상적인 피로가 있으면 훈련을 중단하고 회복 또는 전문가 상담을 우선하세요.";
        return proposal;
    }

    function computeDashboard(profile, activities, health) {
        var now = Date.now();
        var dayMs = 86400000;
        var runs = decorateActivities(activities, health);
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
        var metrics = {
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
        };
        return {
            profile: profile,
            activities: runs,
            health: health || null,
            metrics: metrics,
            analysis: {
                title: title,
                summary: summary,
                points: points
            },
            nextTraining: suggestNextTraining(profile, runs, metrics),
            plan: buildPlan(profile, weekKm, phase, score)
        };
    }

    function buildPlan(profile, weekKm, phase, score) {
        if (!profile || !profile.raceDate) return [];
        var days = Number(profile.daysPerWeek || 4);
        var raceDistance = Number(profile.distanceKm || 10);
        var fallbackVolume = raceDistance <= 42.195
            ? raceDistance * 2.4
            : Math.min(120, raceDistance * 1.2);
        var baseDistance = Math.max(15, weekKm || fallbackVolume);
        var targetPace = profile.goalTimeSeconds
            ? profile.goalTimeSeconds / Number(profile.distanceKm)
            : null;
        var easyPace = targetPace ? targetPace + 65 : null;
        var keyPace = targetPace ? Math.max(210, targetPace - (phase === "SHARPEN" ? 5 : -10)) : null;
        var raceLongTarget = raceDistance <= 42.195
            ? raceDistance * (phase === "TAPER" ? 0.45 : 0.72)
            : Math.min(50, baseDistance * (phase === "TAPER" ? 0.28 : 0.45));
        var longKm = raceDistance <= 42.195
            ? Math.max(raceLongTarget, baseDistance * 0.34)
            : Math.min(50, Math.max(raceLongTarget, baseDistance * 0.34));
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

    function renderTrendBars(nodeId, buckets, field, formatter) {
        var values = buckets.map(function (bucket) {
            return Number(bucket[field] || 0);
        });
        var max = Math.max.apply(Math, values.concat([1]));
        el(nodeId).innerHTML = buckets.map(function (bucket, index) {
            var value = Number(bucket[field] || 0);
            var height = value ? Math.max(10, Math.round((value / max) * 96)) : 4;
            var weeksAgo = buckets.length - index - 1;
            var label = weeksAgo === 0 ? "이번 주" : weeksAgo + "주 전";
            return '<div class="trend-bar-wrap">' +
                '<span class="trend-value">' + escapeHtml(value ? formatter(value) : "—") + "</span>" +
                '<div class="trend-bar" style="height:' + height + 'px"></div>' +
                '<small>' + escapeHtml(label) + "</small>" +
                "</div>";
        }).join("");
    }

    function renderDistribution(nodeId, entries, total, unit) {
        var safeTotal = Math.max(0, Number(total || 0));
        el(nodeId).innerHTML = entries.map(function (entry) {
            var value = Number(entry.value || 0);
            var percentage = safeTotal ? Math.round((value / safeTotal) * 100) : 0;
            return '<div class="distribution-row">' +
                '<div><span>' + escapeHtml(entry.label) + '</span><strong>' +
                escapeHtml(unit === "km" ? formatDistance(value) + " km" : percentage + "%") +
                "</strong></div>" +
                '<div class="distribution-track"><i style="width:' + percentage + '%"></i></div>' +
                "</div>";
        }).join("");
    }

    function renderTrends(dashboard) {
        var trend = computeTrendData(dashboard.activities || [], trendWeeks, dashboard.health);
        var vdotValue = trend.currentVdot == null ? "—" : trend.currentVdot.toFixed(1);
        var vdotChange = trend.vdotChange == null
            ? "비교 데이터 부족"
            : (trend.vdotChange >= 0 ? "+" : "") + trend.vdotChange.toFixed(1) + " · 첫 주 대비";
        var heartBasis = trend.maxHr
            ? "관측 최고 " + trend.maxHr + "bpm" +
                (trend.restingHr ? " · 안정 " + Math.round(trend.restingHr) + "bpm" : "") +
                " 기준"
            : "심박 기록이 충분하지 않아 구간을 계산하지 않았습니다.";
        el("trendSummary").innerHTML = [
            {
                label: "VDOT 추정",
                value: vdotValue,
                note: vdotChange
            },
            {
                label: trend.weeks + "주 러닝",
                value: trend.runCount + "회",
                note: formatDistance(trend.totalDistance) + " km"
            },
            {
                label: "심박존 기준",
                value: trend.maxHr ? trend.maxHr + " bpm" : "—",
                note: trend.maxHr ? "최근 관측 최고심박" : "심박 데이터 필요"
            }
        ].map(function (card) {
            return '<article><span>' + escapeHtml(card.label) + '</span><strong>' +
                escapeHtml(card.value) + '</strong><small>' + escapeHtml(card.note) + "</small></article>";
        }).join("");
        el("distanceTrendLabel").textContent = trend.weeks + "주 · 총 " +
            formatDistance(trend.totalDistance) + "km";
        renderTrendBars("distanceTrend", trend.buckets, "distance", function (value) {
            return formatDistance(value);
        });
        renderTrendBars("vdotTrend", trend.buckets, "vdot", function (value) {
            return value.toFixed(1);
        });
        var typeEntries = Object.keys(runTypeMeta).map(function (key) {
            return { label: runTypeMeta[key].label, value: trend.typeTotals[key] };
        });
        renderDistribution("runTypeDistribution", typeEntries, trend.totalDistance, "km");
        var zoneTotal = trend.zoneSeconds.reduce(function (sum, value) { return sum + value; }, 0);
        renderDistribution("heartZoneDistribution", trend.zoneSeconds.map(function (value, index) {
            return { label: "ZONE " + (index + 1), value: value };
        }), zoneTotal, "percent");
        el("heartZoneBasis").textContent = heartBasis;
    }

    function renderNextTraining(recommendation) {
        if (!recommendation || !recommendation.title) {
            el("nextTrainingType").textContent = "READY";
            el("nextTraining").innerHTML =
                '<p class="empty-state">기록을 연결하면 다음 훈련과 추천 근거를 표시합니다.</p>';
            return;
        }
        el("nextTrainingType").textContent = recommendation.type || "NEXT";
        el("nextTraining").innerHTML =
            '<article class="next-training-main">' +
            '<span>다음 훈련</span><h3>' + escapeHtml(recommendation.title) + '</h3>' +
            '<p>' + escapeHtml(recommendation.prescription || "") + '</p></article>' +
            '<article class="next-training-why"><span>왜 이 훈련인가요?</span><ol>' +
            (recommendation.why || []).slice(0, 4).map(function (reason) {
                return "<li>" + escapeHtml(reason) + "</li>";
            }).join("") +
            '</ol><small>' + escapeHtml(recommendation.caution || "") + "</small></article>";
    }

    function localDateKey(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    function renderCalendar(plan, activities) {
        var first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
        var start = new Date(first);
        start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
        var actualByDate = {};
        var planByDate = {};
        (activities || []).forEach(function (activity) {
            var key = String(activity.date || "").slice(0, 10);
            if (!key) return;
            if (!actualByDate[key]) actualByDate[key] = [];
            actualByDate[key].push(activity);
        });
        (plan || []).forEach(function (day) {
            if (!planByDate[day.date]) planByDate[day.date] = [];
            planByDate[day.date].push(day);
        });
        el("calendarTitle").textContent = first.getFullYear() + "년 " + (first.getMonth() + 1) + "월";
        var today = localDateKey(new Date());
        var cells = [];
        for (var index = 0; index < 42; index += 1) {
            var date = new Date(start);
            date.setDate(start.getDate() + index);
            var key = localDateKey(date);
            var actual = actualByDate[key] || [];
            var scheduled = planByDate[key] || [];
            var outside = date.getMonth() !== first.getMonth();
            var events = [];
            actual.slice(0, 1).forEach(function (activity) {
                events.push('<span class="calendar-event actual">' +
                    escapeHtml(activity.runTypeLabel || "러닝") + " " +
                    escapeHtml(formatDistance(activity.distanceKm)) + "km</span>");
            });
            scheduled.slice(0, actual.length ? 1 : 2).forEach(function (day) {
                events.push('<span class="calendar-event ' +
                    (day.rest ? "rest" : day.key ? "key" : "planned") + '">' +
                    escapeHtml(day.title) + "</span>");
            });
            if (actual.length + scheduled.length > events.length) {
                events.push('<small class="calendar-more">+' +
                    (actual.length + scheduled.length - events.length) + "개</small>");
            }
            cells.push('<article class="calendar-day' +
                (outside ? " is-outside" : "") +
                (key === today ? " is-today" : "") +
                '" role="gridcell" aria-label="' + escapeHtml(key) + '">' +
                '<time datetime="' + escapeHtml(key) + '">' + date.getDate() + "</time>" +
                '<div class="calendar-events">' + events.join("") + "</div></article>");
        }
        el("trainingCalendar").innerHTML = cells.join("");
    }

    function renderAnalysis(analysis, analysisJob) {
        el("analysisTitle").textContent = analysis && analysis.title || "목표와 기록을 연결해 주세요.";
        el("analysisSummary").textContent = analysis && analysis.summary ||
            "최근 훈련량, 페이스 변화, 회복 정보를 함께 비교해 오늘의 상태와 다음 훈련 방향을 제안합니다.";
        el("analysisPoints").innerHTML = (analysis && analysis.points || []).map(function (point) {
            return "<li>" + escapeHtml(point) + "</li>";
        }).join("");
        var verification = analysis && analysis.verification;
        var badge = el("analysisVerification");
        var automationStatus = el("analysisAutomationStatus");
        var jobStatus = analysisJob && analysisJob.status;
        var jobLabels = {
            queued: "분석 요청 대기",
            codex_queued: "CODEX 분석 대기",
            codex_processing: "CODEX 상세 분석 중",
            auth_required: "CODEX 인증 확인 필요",
            failed: "상세 분석 실패"
        };
        if (jobLabels[jobStatus]) {
            badge.hidden = false;
            badge.classList.remove("is-adjusted");
            badge.classList.add("is-single");
            badge.textContent = jobLabels[jobStatus];
            badge.title = "";
            automationStatus.textContent = {
                queued: "상세 러닝 분석 요청을 안전한 대기열에 등록했습니다.",
                codex_queued: "Codex 상세 러닝 분석을 기다리고 있습니다.",
                codex_processing: "Codex가 최근 12주 개별 러닝과 회복 수치를 분석하고 있습니다.",
                auth_required: "Codex 분석 서비스 인증 갱신이 필요합니다.",
                failed: "상세 분석을 완료하지 못했습니다. 잠시 후 다시 분석해 주세요."
            }[jobStatus];
            return;
        }
        if (!verification || !verification.status) {
            badge.hidden = true;
            badge.textContent = "";
            badge.removeAttribute("title");
            automationStatus.textContent =
                "분석을 실행하면 Codex가 최근 12주 상세 기록을 직접 분석합니다.";
            return;
        }
        badge.hidden = false;
        badge.classList.remove("is-adjusted");
        badge.classList.add("is-single");
        badge.textContent = ["codex_analyzed", "codex_verified"].includes(verification.status)
            ? "CODEX 분석 완료"
            : "RUNBRO 분석";
        badge.title = verification.note || "";
        automationStatus.textContent = ["codex_analyzed", "codex_verified"].includes(verification.status)
            ? "최근 12주 개별 러닝과 Garmin 회복 수치를 Codex가 직접 분석해 저장한 결과입니다."
            : "새 상세 분석을 실행하면 Codex 직접 분석 결과로 갱신됩니다.";
    }

    function renderLatestRunAnalysis(analysis, activities) {
        var review = analysis && analysis.latestRunAnalysis;
        var latest = activities && activities.length ? activities[0] : null;
        var reviewMatchesLatest = Boolean(
            review &&
            latest &&
            String(review.runDate) === String(latest.date || "").slice(0, 10)
        );
        var type = reviewMatchesLatest ? review.runType : (latest && latest.runType);
        var meta = runTypeMeta[type] || { label: "러닝", short: "RUN" };
        el("latestRunType").textContent = latest ? meta.short : "NO DATA";
        el("latestRunType").className = "status-chip" + (latest ? " accent-chip" : "");

        if (!latest) {
            el("latestRunTitle").textContent = "최근 러닝을 동기화해 주세요.";
            el("latestRunSummary").textContent =
                "Garmin을 연결하면 가장 최근 러닝의 거리, 페이스, 강도와 회복 관점을 상세히 분석합니다.";
            el("latestRunMetrics").innerHTML = "";
        } else {
            el("latestRunTitle").textContent = reviewMatchesLatest
                ? review.title
                : "최근 러닝 기록이 갱신되었습니다.";
            el("latestRunSummary").textContent = reviewMatchesLatest
                ? review.summary
                : "현재 표시된 최신 기록을 상세 분석하려면 ‘다시 분석’을 눌러 주세요.";
            el("latestRunMetrics").innerHTML = [
                {
                    label: "날짜",
                    value: String(latest.date || "").slice(0, 10) || "—",
                    detail: meta.label
                },
                {
                    label: "거리",
                    value: formatDistance(latest.distanceKm) + " km",
                    detail: "최근 러닝 총거리"
                },
                {
                    label: "평균 페이스",
                    value: formatPace(paceSeconds(latest)),
                    detail: "1km 기준"
                },
                {
                    label: "시간 / 심박",
                    value: formatDuration(Number(latest.movingSeconds || 0)),
                    detail: latest.averageHr
                        ? Math.round(Number(latest.averageHr)) + " bpm"
                        : "심박 데이터 없음"
                }
            ].map(function (item) {
                return "<article><span>" + escapeHtml(item.label) + "</span><strong>" +
                    escapeHtml(item.value) + "</strong><small>" +
                    escapeHtml(item.detail) + "</small></article>";
            }).join("");
        }

        el("latestRunExecution").textContent = reviewMatchesLatest
            ? review.execution
            : "분석을 실행하면 최근 평균과 비교한 거리와 페이스 실행을 평가합니다.";
        el("latestRunIntensity").textContent = reviewMatchesLatest
            ? review.intensity
            : "심박 데이터가 있으면 개인 기록 내 강도 구간을 함께 확인합니다.";
        el("latestRunRecovery").textContent = reviewMatchesLatest
            ? review.recovery
            : "최근 훈련 간격과 누적 거리를 기준으로 회복 관점을 제안합니다.";
        el("latestRunPositives").innerHTML = (reviewMatchesLatest
            ? review.positives
            : ["상세 분석을 실행하면 잘한 점을 근거와 함께 표시합니다."]
        ).map(function (point) {
            return "<li>" + escapeHtml(point) + "</li>";
        }).join("");
        el("latestRunCautions").innerHTML = (reviewMatchesLatest
            ? review.cautions
            : ["새 기록과 이전 훈련의 차이를 분석한 뒤 표시합니다."]
        ).map(function (point) {
            return "<li>" + escapeHtml(point) + "</li>";
        }).join("");
        el("latestRunNextFocus").textContent = reviewMatchesLatest
            ? review.nextFocus
            : "최근 러닝 분석을 실행하면 다음 러닝에서 확인할 포인트를 표시합니다.";
    }

    function selectAnalysisTab(tabName) {
        var latestSelected = tabName === "latest";
        var raceTab = el("analysisTabRace");
        var latestTab = el("analysisTabLatest");
        raceTab.classList.toggle("is-active", !latestSelected);
        latestTab.classList.toggle("is-active", latestSelected);
        raceTab.setAttribute("aria-selected", String(!latestSelected));
        latestTab.setAttribute("aria-selected", String(latestSelected));
        el("raceAnalysisPane").hidden = latestSelected;
        el("latestRunAnalysisPane").hidden = !latestSelected;
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
            el("activityRows").innerHTML = '<tr><td colspan="6" class="empty-cell">연결된 기록이 없습니다.</td></tr>';
            return;
        }
        el("activityRows").innerHTML = runs.slice(0, 8).map(function (activity) {
            return "<tr>" +
                "<td>" + escapeHtml(String(activity.date).slice(0, 10)) + "</td>" +
                '<td class="activity-name">' + escapeHtml(activity.name || "러닝") + "</td>" +
                '<td><span class="activity-type type-' + escapeHtml(activity.runType || "zone2") + '">' +
                escapeHtml(activity.runTypeLabel || "존2") + "</span></td>" +
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
        renderTrends(dashboard);
        renderAnalysis(dashboard.analysis, dashboard.analysisJob);
        renderLatestRunAnalysis(dashboard.analysis, dashboard.activities);
        renderAnalysisEvidence(dashboard);
        renderNextTraining(dashboard.nextTraining);
        renderPlan(dashboard.plan, dashboard.metrics || {});
        renderCalendar(dashboard.plan, dashboard.activities);
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
        normalized.analysisJob = body && body.analysisJob || null;
        if (body && body.analysis && body.analysis.title) {
            var storedAnalysis = Object.assign({}, body.analysis);
            var storedPoints = Array.isArray(storedAnalysis.points)
                ? storedAnalysis.points.slice(0, 5)
                : [];
            storedAnalysis.points = storedPoints.concat(
                normalized.analysis.points.slice(storedPoints.length)
            ).slice(0, 5);
            normalized.analysis = storedAnalysis;
            if (storedAnalysis.recommendation && storedAnalysis.recommendation.title) {
                normalized.nextTraining = storedAnalysis.recommendation;
            }
            if (
                Array.isArray(storedAnalysis.trainingPlan) &&
                storedAnalysis.trainingPlan.length === 7
            ) {
                normalized.plan = storedAnalysis.trainingPlan;
            }
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
        dashboard.analysis.latestRunAnalysis = {
            runDate: String(dashboard.activities[0].date).slice(0, 10),
            runType: dashboard.activities[0].runType || "zone2",
            title: "페이스와 강도를 안정적으로 유지한 러닝",
            summary: "최근 평균과 비교해 거리와 페이스가 안정적인 범위였고, 다음 품질 훈련 전 회복을 확인하기 좋은 기록입니다.",
            execution: "초반부터 마무리까지 평균 페이스가 크게 흔들리지 않은 실행으로 분류했습니다.",
            intensity: "관측 심박 기준으로 유산소 중심 강도이며 과도한 고강도 신호는 확인되지 않았습니다.",
            recovery: "최근 러닝 간격을 고려하면 다음 날은 쉬운 러닝이나 휴식이 적절합니다.",
            positives: [
                "현재 주간 훈련 흐름을 해치지 않는 거리로 마무리했습니다.",
                "다음 훈련으로 연결하기 좋은 강도 범위를 유지했습니다."
            ],
            cautions: ["다리가 무겁거나 수면이 부족하면 다음 훈련 강도를 낮추세요."],
            nextFocus: "다음 러닝에서는 같은 호흡을 유지하면서 후반 페이스 변화를 확인하세요."
        };
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
        var typeCounts = { interval: 0, tempo: 0, zone2: 0, long: 0, recovery: 0 };
        var heartZoneSeconds = [0, 0, 0, 0, 0];
        var vdotValues = [];
        var decorated = decorateActivities(
            dashboard && dashboard.activities || [],
            dashboard && dashboard.health
        );
        decorated.forEach(function (activity) {
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
            if (typeCounts[activity.runType] != null) typeCounts[activity.runType] += 1;
            if (activity.heartRateZone >= 1 && activity.heartRateZone <= 5) {
                heartZoneSeconds[activity.heartRateZone - 1] += seconds;
            }
            if (Number.isFinite(Number(activity.estimatedVdot))) {
                vdotValues.push(Number(activity.estimatedVdot));
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
            estimatedVdot: vdotValues.length
                ? Math.round(Math.max.apply(Math, vdotValues) * 10) / 10
                : null,
            runTypeCounts: typeCounts,
            heartZoneMinutes: heartZoneSeconds.map(function (seconds) {
                return Math.round(seconds / 60);
            }),
            health: {
                sleepHours: optionalNumber(health.sleepHours),
                hrv: optionalNumber(health.hrv),
                restingHeartRate: optionalNumber(health.restingHr),
                trainingReadiness: optionalNumber(health.trainingReadiness)
            }
        };
    }

    function loadCombinedDashboard(baseRequest, options) {
        var settings = options || {};
        return Promise.all([baseRequest, fetchGarminDashboard()]).then(function (values) {
            var dashboard = normalizeDashboard(mergeProviderDashboards(values[0], values[1]));
            if (
                !settings.autoSync ||
                !dashboard.connections ||
                !dashboard.connections.garmin ||
                !dashboard.connections.garmin.connected ||
                autoSyncCompleted()
            ) {
                return values;
            }
            markAutoSync("running");
            setFormStatus("로그인 확인 완료 · Garmin 최신 기록을 자동으로 동기화하고 있습니다.");
            return apiRequest("/garmin/sync", { method: "POST", body: "{}" })
                .then(function (garminDashboard) {
                    markAutoSync("complete");
                    setFormStatus("Garmin 최신 기록을 자동으로 동기화했습니다.");
                    return [values[0], garminDashboard];
                })
                .catch(function (error) {
                    markAutoSync("failed");
                    setFormStatus(
                        error.code === "sync_in_progress"
                            ? "Garmin 기록 동기화가 이미 진행 중입니다."
                            : "자동 동기화를 완료하지 못했습니다. ‘최신 기록 동기화’로 다시 시도해 주세요.",
                        error.code !== "sync_in_progress"
                    );
                    return values;
                });
        }).then(function (values) {
            var dashboard = normalizeDashboard(mergeProviderDashboards(values[0], values[1]));
            renderDashboard(dashboard);
            if (dashboard.analysisJob && isPendingAnalysis(dashboard.analysisJob.status)) {
                return pollAnalysisJob(
                    dashboard.analysisJob.jobId,
                    values[1],
                    ++analysisPollToken,
                    0
                );
            }
            return dashboard;
        });
    }

    function markAutoSync(status) {
        try {
            sessionStorage.setItem(autoSyncStorageKey, status);
        } catch (error) {
            // Storage can be unavailable in hardened browser modes.
        }
    }

    function autoSyncCompleted() {
        try {
            return Boolean(sessionStorage.getItem(autoSyncStorageKey));
        } catch (error) {
            return false;
        }
    }

    function clearAutoSyncMarker() {
        try {
            sessionStorage.removeItem(autoSyncStorageKey);
        } catch (error) {
            // Nothing to clear when storage is unavailable.
        }
    }

    function isPendingAnalysis(status) {
        return ["queued", "codex_queued", "codex_processing"].includes(status);
    }

    function analysisFailureMessage(job) {
        if (job && job.status === "auth_required") {
            return "Codex 자동 검증 인증 갱신이 필요합니다. 잠시 후 다시 시도해 주세요.";
        }
        return "자동 분석을 완료하지 못했습니다. 잠시 후 다시 분석해 주세요.";
    }

    function pollAnalysisJob(jobId, garminDashboard, token, attempt) {
        if (token !== analysisPollToken) return Promise.resolve(currentDashboard);
        if (attempt >= 120) {
            throw new Error("분석 시간이 예상보다 길어지고 있습니다. 잠시 후 다시 확인해 주세요.");
        }
        var delay = attempt < 2 ? 2000 : 5000;
        return new Promise(function (resolve) {
            window.setTimeout(resolve, delay);
        }).then(function () {
            if (token !== analysisPollToken) return currentDashboard;
            return apiRequest("/analysis/" + encodeURIComponent(jobId), { method: "GET" });
        }).then(function (body) {
            if (!body || token !== analysisPollToken) return currentDashboard;
            var dashboard = normalizeDashboard(
                mergeProviderDashboards(body, garminDashboard)
            );
            renderDashboard(dashboard);
            var job = dashboard.analysisJob || {};
            if (job.status === "complete") {
                setFormStatus("Codex 상세 러닝 분석을 완료했습니다.");
                return dashboard;
            }
            if (job.status === "failed" || job.status === "auth_required") {
                throw new Error(analysisFailureMessage(job));
            }
            setFormStatus(job.status === "codex_processing"
                ? "Codex가 최근 12주 상세 러닝 기록을 분석하고 있습니다."
                : "Codex 상세 러닝 분석을 기다리고 있습니다.");
            return pollAnalysisJob(jobId, garminDashboard, token, attempt + 1);
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
                body: "{}"
            });
        }).then(function (analyzed) {
            var dashboard = normalizeDashboard(
                mergeProviderDashboards(analyzed, garminDashboard)
            );
            renderDashboard(dashboard);
            if (dashboard.analysisJob && isPendingAnalysis(dashboard.analysisJob.status)) {
                setFormStatus("러닝 분석 요청을 등록했습니다.");
                return pollAnalysisJob(
                    dashboard.analysisJob.jobId,
                    garminDashboard,
                    ++analysisPollToken,
                    0
                );
            }
            if (
                dashboard.analysisJob &&
                ["failed", "auth_required"].includes(dashboard.analysisJob.status)
            ) {
                throw new Error(analysisFailureMessage(dashboard.analysisJob));
            }
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
        setFormStatus("");
        return loadCombinedDashboard(
            apiRequest("/dashboard", { method: "GET" }),
            { autoSync: true }
        ).catch(function (error) {
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
        if (!profile.goalTimeSeconds || profile.goalTimeSeconds < 300 || profile.goalTimeSeconds > 864000) {
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
            .then(function (dashboard) {
                markAutoSync("complete");
                return dashboard;
            })
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
                markAutoSync("complete");
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

    function selectTrendPeriod(button) {
        var weeks = Number(button.dataset.periodWeeks);
        if (![4, 8, 12].includes(weeks)) return;
        trendWeeks = weeks;
        document.querySelectorAll("[data-period-weeks]").forEach(function (candidate) {
            var active = candidate === button;
            candidate.classList.toggle("is-active", active);
            candidate.setAttribute("aria-pressed", active ? "true" : "false");
        });
        if (currentDashboard) renderTrends(currentDashboard);
    }

    function shiftCalendar(months) {
        calendarCursor = new Date(
            calendarCursor.getFullYear(),
            calendarCursor.getMonth() + months,
            1
        );
        if (currentDashboard) {
            renderCalendar(currentDashboard.plan, currentDashboard.activities);
        }
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
        el("refreshDetailedAnalysis").addEventListener("click", refreshAnalysis);
        el("analysisTabRace").addEventListener("click", function () {
            selectAnalysisTab("race");
        });
        el("analysisTabLatest").addEventListener("click", function () {
            selectAnalysisTab("latest");
        });
        [el("analysisTabRace"), el("analysisTabLatest")].forEach(function (tab, index, tabs) {
            tab.addEventListener("keydown", function (event) {
                if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                event.preventDefault();
                var nextIndex = event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : (index - 1 + tabs.length) % tabs.length;
                selectAnalysisTab(nextIndex === 1 ? "latest" : "race");
                tabs[nextIndex].focus();
            });
        });
        document.querySelectorAll("[data-period-weeks]").forEach(function (button) {
            button.addEventListener("click", function () { selectTrendPeriod(button); });
        });
        el("calendarPrev").addEventListener("click", function () { shiftCalendar(-1); });
        el("calendarNext").addEventListener("click", function () { shiftCalendar(1); });
        el("calendarToday").addEventListener("click", function () {
            var today = new Date();
            calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
            if (currentDashboard) {
                renderCalendar(currentDashboard.plan, currentDashboard.activities);
            }
        });
        el("disconnectButton").addEventListener("click", disconnectAll);

        document.addEventListener("goyoungo:authchange", function (event) {
            if (event.detail && event.detail.authenticated) {
                loadDashboard();
            } else {
                clearAutoSyncMarker();
                renderDashboard(computeDashboard(null, []));
            }
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
