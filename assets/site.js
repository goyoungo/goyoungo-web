(function () {
    "use strict";

    var data = window.SITE_DATA;
    var root = document.getElementById("pageRoot");
    if (!data || !root) return;

    var voteApiUrl = data.config && data.config.voteApiUrl
        ? String(data.config.voteApiUrl).replace(/\/$/, "")
        : "";
    var voteState = new Map();
    var voteVenueIds = [];
    var voteReadSequence = 0;
    var voteAuthEpoch = 0;
    var rankingPage = null;
    var rankingRenderPending = false;
    var localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
        new URLSearchParams(window.location.search).has("preview");

    function normalizeVenueName(value) {
        var aliases = {
            "고향막국수": "봉평고향막국수",
            "둔내웅이네": "웅이네",
            "싼타클로스버거": "싼타버거",
            "한우피아": "횡성한우피아",
            "화이트크로우브루잉": "화이트크로우브루잉컴퍼니"
        };
        var normalized = String(value || "")
            .toLocaleLowerCase("ko-KR")
            .replace(/[\s·,().&/+-]/g, "")
            .replace(/(본점|둔내점|봉평점|면온점|평창점|하이원점|용평리조트점)$/, "");
        return aliases[normalized] || normalized;
    }

    function mergeMenuTags(primary, secondary) {
        var merged = [];
        var seen = new Set();
        [primary, secondary].forEach(function (items) {
            (Array.isArray(items) ? items : []).forEach(function (item) {
                var value = String(item || "").replace(/\s+/g, " ").trim();
                var key = value.toLocaleLowerCase("ko-KR");
                if (!value || seen.has(key) || merged.length >= 5) return;
                seen.add(key);
                merged.push(value);
            });
        });
        return merged;
    }

    function mergeImportedRestaurants() {
        var imported = window.NAVER_RESTAURANTS;
        if (!imported || !imported.pages) return;

        var resortNames = {
            welpark: "웰리힐리파크",
            phoenix: "휘닉스 평창",
            yongpyong: "모나 용평",
            high1: "하이원리조트"
        };

        Object.keys(resortNames).forEach(function (pageId) {
            var page = data.pages[pageId];
            var importedItems = imported.pages[pageId];
            if (!page || !Array.isArray(importedItems) || !Array.isArray(page.sections)) return;

            var openSection = page.sections.find(function (section) {
                return section.id === "open";
            });
            if (!openSection) return;

            var allItems = page.sections.reduce(function (items, section) {
                return items.concat(section.items || []);
            }, []);

            importedItems.forEach(function (sourceItem) {
                var normalizedName = normalizeVenueName(sourceItem.name);
                var sourceMenus = mergeMenuTags(sourceItem.menus, []);
                var existing = allItems.find(function (item) {
                    return normalizeVenueName(item.name) === normalizedName;
                });
                var importedFields = {
                    naverId: sourceItem.naverId,
                    naverUrl: "https://map.naver.com/p/entry/place/" + sourceItem.naverId,
                    driveFrom: resortNames[pageId],
                    driveMinutes: sourceItem.driveMinutes,
                    votingEnabled: sourceItem.votingEnabled !== false &&
                        Boolean(data.config && data.config.importedVotingEnabled)
                };

                if (existing) {
                    delete importedFields.votingEnabled;
                    Object.assign(existing, importedFields);
                    existing.menus = mergeMenuTags(sourceMenus, existing.menus);
                    if (!existing.address) existing.address = sourceItem.address;
                    if (!existing.note && sourceItem.memo) existing.note = sourceItem.memo;
                    return;
                }

                var newItem = Object.assign({
                    id: "naver-" + sourceItem.naverId,
                    name: sourceItem.name,
                    menus: sourceMenus,
                    address: sourceItem.address,
                    phone: "",
                    recommenders: [],
                    detractors: [],
                    score: 0,
                    note: sourceItem.memo || "네이버 지도 등록 업체",
                    hours: ""
                }, importedFields);
                openSection.items.push(newItem);
                allItems.push(newItem);
            });

            page.sections.forEach(function (section) {
                (section.items || []).forEach(function (item) {
                    item.menus = mergeMenuTags(item.menus, []);
                });
            });

            page.naverSource = {
                title: imported.source.title,
                url: imported.source.url,
                importedCount: importedItems.length,
                routeBasis: imported.source.routeBasis,
                menuSnapshotDate: imported.source.menuSource &&
                    imported.source.menuSource.snapshotDate,
                menuPlacesWithMenus: importedItems.filter(function (item) {
                    return Array.isArray(item.menus) && item.menus.length > 0;
                }).length
            };

            var total = page.sections.reduce(function (sum, section) {
                return sum + section.items.length;
            }, 0);
            var navigationItem = data.navigation.find(function (item) {
                return item.id === pageId;
            });
            if (navigationItem) {
                navigationItem.summary = resortNames[pageId] + " 주변 맛집 " + total + "곳";
            }
        });
    }

    mergeImportedRestaurants();

    function esc(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[character];
        });
    }

    function textOrDash(value) {
        return value ? esc(value) : '<span class="faint">—</span>';
    }

    function externalLink(url, label, className) {
        if (!/^https?:\/\//i.test(url || "")) return esc(label);
        return '<a class="' + (className || "text-link") + '" href="' + esc(url) +
            '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>";
    }

    function phoneLink(phone, label) {
        var dial = String(phone || "").replace(/[^\d+]/g, "");
        if (!dial) return textOrDash("");
        return '<a class="phone-link" href="tel:' + esc(dial) + '">' + esc(label || phone) + "</a>";
    }

    function tagsHtml(items) {
        var values = Array.isArray(items) ? items.filter(Boolean) : [];
        if (!values.length) return '<span class="faint">—</span>';
        return '<div class="tag-list">' + values.map(function (item) {
            return '<span class="tag">' + esc(item) + "</span>";
        }).join("") + "</div>";
    }

    function formatMoney(value) {
        return typeof value === "number"
            ? new Intl.NumberFormat("ko-KR").format(value) + "원"
            : esc(value || "");
    }

    function hero(page) {
        return [
            '<a class="back-link" href="/index.html" aria-label="홈으로 돌아가기">← 전체 정보</a>',
            '<header class="page-hero">',
            '<div class="page-icon" aria-hidden="true">' + esc(page.icon) + "</div>",
            '<p class="eyebrow">GO.YOUNGO · GANGWON</p>',
            "<h1>" + esc(page.title) + "</h1>",
            "<p>" + esc(page.subtitle || "") + "</p>",
            '<p class="snapshot-note">마지막 정보 스냅샷 · ' + esc(data.brand.snapshotDate) + "</p>",
            "</header>"
        ].join("");
    }

    function footer() {
        return [
            '<footer class="source-footer">',
            "<strong>GO.YOUNGO</strong> · 보더와 스키어가 함께 정리한 강원 스키 라이프 정보입니다. ",
            "운영 정보는 달라질 수 있으니 방문 전 업체에 확인해 주세요.",
            "</footer>"
        ].join("");
    }

    function renderHome() {
        document.title = data.brand.title + " - " + data.brand.byline;
        var categories = {
            welpark: "EAT",
            phoenix: "EAT",
            yongpyong: "EAT",
            high1: "EAT",
            market: "MARKET",
            season: "STAY",
            partner: "BENEFIT",
            shuttle: "RIDE"
        };
        var cards = data.navigation.map(function (item, index) {
            var featured = item.id === "welpark" || item.id === "phoenix";
            return [
                '<a class="hub-card ' + (featured ? "is-featured" : "") + '" href="' + esc(item.href) + '">',
                '<span class="hub-index">' + String(index + 1).padStart(2, "0") + " · " +
                    esc(categories[item.id] || "GUIDE") + "</span>",
                '<span class="hub-arrow" aria-hidden="true">↗</span>',
                "<strong>" + esc(item.title) + "</strong>",
                "<small>" + esc(item.summary) + "</small>",
                "</a>"
            ].join("");
        }).join("");

        var restaurantTotal = ["welpark", "phoenix", "yongpyong", "high1"].reduce(function (total, pageId) {
            var page = data.pages[pageId];
            if (!page || !Array.isArray(page.sections)) return total;
            return total + page.sections.reduce(function (sum, section) {
                return sum + section.items.length;
            }, 0);
        }, 0);
        var snapshot = new Date(data.brand.snapshotDate);
        var snapshotLabel = Number.isNaN(snapshot.getTime())
            ? data.brand.snapshotDate
            : String(snapshot.getMonth() + 1).padStart(2, "0") + "." +
                String(snapshot.getDate()).padStart(2, "0");

        root.innerHTML = [
            '<div class="page-wrap home-page">',
            '<section class="home-hero" aria-labelledby="homeTitle">',
            '<div class="home-hero-main">',
            '<p class="home-kicker">GANGWON SNOW DIRECTORY · 2026</p>',
            '<h1 id="homeTitle">스키장 정보 공유</h1>',
            '<div class="home-hero-foot">',
            "<p>리조트 주변의 맛집부터 장비 거래, 시즌방, 제휴 혜택과 셔틀까지. 보더와 스키어가 직접 모은 로컬 정보를 한눈에 만나보세요.</p>",
            '<a href="#directory">오늘의 디렉터리 보기 ↘</a>',
            "</div></div>",
            '<aside class="season-note" aria-label="이번 시즌 정보">',
            '<div class="season-note-top"><span>SEASON NOTE</span><span>' + esc(snapshotLabel) + "</span></div>",
            '<div><strong>' + restaurantTotal + "</strong>",
            "<p>직접 모은 리조트 맛집을 담았습니다. 영업시간과 휴무일은 방문 전에 다시 확인해 주세요.</p></div>",
            "</aside>",
            "</section>",
            '<section class="directory-section" id="directory" aria-labelledby="directoryTitle">',
            '<div class="directory-heading">',
            '<h2 id="directoryTitle">오늘 어디로 갈까요?</h2>',
            "<p>지역과 필요한 정보를 골라 바로 시작하세요</p>",
            "</div>",
            '<nav class="hub-grid" aria-label="스키장 정보 페이지">' + cards + "</nav>",
            "</section>",
            '<section class="update-request" id="update" aria-labelledby="updateTitle">',
            '<div class="update-request-intro">',
            '<p class="eyebrow">COMMUNITY UPDATE</p>',
            '<h2 id="updateTitle">달라진 정보를 발견했나요?</h2>',
            "<p>영업시간, 휴무일, 위치처럼 달라진 내용을 알려주세요. 작성한 내용을 복사해 @go.youngo 인스타그램 DM으로 보내며, 카카오 로그인이 필요합니다.</p>",
            "</div>",
            '<button class="update-request-button" id="openUpdateRequest" type="button">정보 수정 요청 →</button>',
            '<form class="update-request-form" id="updateRequestForm" hidden>',
            '<div class="update-form-grid">',
            '<label><span>수정 유형</span><select name="category" required>',
            '<option value="영업시간/휴무">영업시간/휴무</option>',
            '<option value="위치/연락처">위치/연락처</option>',
            '<option value="메뉴/가격">메뉴/가격</option>',
            '<option value="폐업/신규">폐업/신규</option>',
            '<option value="기타">기타</option>',
            "</select></label>",
            '<label><span>가게 또는 항목</span><input name="target" type="text" maxlength="100" placeholder="예: 고원곰탕" required></label>',
            '<label class="update-form-detail"><span>달라진 내용</span>',
            '<textarea name="details" rows="5" minlength="5" maxlength="1000" placeholder="확인한 변경 내용을 적어주세요." required></textarea></label>',
            "</div>",
            '<div class="update-form-actions">',
            '<button class="action-link primary" type="submit">내용 복사하고 인스타그램 열기</button>',
            '<a class="action-link" href="https://www.instagram.com/go.youngo/" target="_blank" rel="noopener noreferrer">@go.youngo 프로필 ↗</a>',
            '<span class="update-form-status" id="updateRequestStatus" role="status" aria-live="polite"></span>',
            "</div>",
            "</form>",
            "</section>",
            footer(),
            "</div>"
        ].join("");
        bindUpdateRequest();
    }

    function bindUpdateRequest() {
        var trigger = document.getElementById("openUpdateRequest");
        var form = document.getElementById("updateRequestForm");
        var status = document.getElementById("updateRequestStatus");
        if (!trigger || !form || !status) return;

        function revealForm() {
            form.hidden = false;
            trigger.setAttribute("aria-expanded", "true");
            var firstField = form.querySelector("select, input, textarea");
            if (firstField) firstField.focus();
        }

        trigger.setAttribute("aria-expanded", "false");
        trigger.addEventListener("click", function () {
            if (!form.hidden) {
                form.hidden = true;
                trigger.setAttribute("aria-expanded", "false");
                trigger.focus();
                return;
            }

            if (getVoteToken()) {
                revealForm();
                return;
            }

            if (window.GoyoungoAuth && typeof window.GoyoungoAuth.requestLogin === "function") {
                window.GoyoungoAuth.requestLogin(
                    "정보 수정 요청을 작성하려면 카카오 로그인이 필요합니다.",
                    revealForm
                );
            }
        });

        function copyRequestText(text) {
            if (navigator.clipboard && window.isSecureContext) {
                return navigator.clipboard.writeText(text);
            }

            return new Promise(function (resolve, reject) {
                var helper = document.createElement("textarea");
                helper.value = text;
                helper.setAttribute("readonly", "");
                helper.style.position = "fixed";
                helper.style.opacity = "0";
                document.body.appendChild(helper);
                helper.select();

                try {
                    if (!document.execCommand("copy")) {
                        throw new Error("copy_failed");
                    }
                    resolve();
                } catch (error) {
                    reject(error);
                } finally {
                    helper.remove();
                }
            });
        }

        form.addEventListener("submit", async function (event) {
            event.preventDefault();

            if (localPreview) {
                status.textContent = "운영 사이트에서 로그인한 뒤 제출할 수 있습니다.";
                return;
            }

            var token = getVoteToken();
            if (!token) {
                if (window.GoyoungoAuth && typeof window.GoyoungoAuth.requestLogin === "function") {
                    window.GoyoungoAuth.requestLogin(
                        "정보 수정 요청을 보내려면 카카오 로그인이 필요합니다.",
                        function () {
                            status.textContent = "로그인되었습니다. 버튼을 다시 눌러 인스타그램을 열어주세요.";
                            form.querySelector('button[type="submit"]').focus();
                        }
                    );
                }
                return;
            }

            var submitButton = form.querySelector('button[type="submit"]');
            var formData = new FormData(form);
            submitButton.disabled = true;
            status.textContent = "요청 내용을 복사하는 중…";

            var requestText = [
                "[고영고 정보 수정 요청]",
                "수정 유형: " + formData.get("category"),
                "가게 또는 항목: " + formData.get("target"),
                "달라진 내용: " + formData.get("details"),
                "페이지: " + window.location.origin + window.location.pathname
            ].join("\n");
            var copyPromise = copyRequestText(requestText);
            window.open(
                "https://www.instagram.com/go.youngo/",
                "_blank",
                "noopener,noreferrer"
            );

            try {
                await copyPromise;
                status.textContent = "요청 내용을 복사했어요. 열린 @go.youngo 프로필에서 메시지를 눌러 붙여넣어 주세요.";
            } catch (error) {
                status.textContent = "자동 복사가 차단되었습니다. 입력 내용을 직접 복사해 @go.youngo DM으로 보내주세요.";
            } finally {
                submitButton.disabled = false;
            }
        });
    }

    function scoreHtml(item) {
        var baseRecommend = item.recommenders.length;
        var baseNotRecommend = item.detractors.length;
        var baseScore = baseRecommend - baseNotRecommend;
        var scoreClass = baseScore > 0 ? "positive" : baseScore < 0 ? "negative" : "";
        var prefix = baseScore > 0 ? "+" : "";

        if (item.votingEnabled === false) {
            return [
                '<div class="vote-unavailable">',
                '<span class="score">—</span>',
                "<strong>평가 준비 중</strong>",
                "<small>신규 등록 장소</small>",
                "</div>"
            ].join("");
        }

        return [
            '<div class="vote-control" data-vote-control data-venue-id="' + esc(item.id) + '"',
            ' data-base-recommend="' + baseRecommend + '" data-base-not-recommend="' + baseNotRecommend + '">',
            '<div class="vote-summary">',
            '<span class="score ' + scoreClass + '" data-score>' + prefix + baseScore + "</span>",
            '<span class="score-detail">기존 기록 포함</span>',
            "</div>",
            '<div class="vote-buttons" role="group" aria-label="' + esc(item.name) + ' 평가">',
            '<button class="vote-button recommend" type="button" data-vote-choice="recommend" aria-pressed="false">',
            '<span aria-hidden="true">👍</span><span>추천</span><strong data-recommend-count>' + baseRecommend + "</strong></button>",
            '<button class="vote-button not-recommend" type="button" data-vote-choice="not_recommend" aria-pressed="false">',
            '<span aria-hidden="true">👎</span><span>비추천</span><strong data-not-recommend-count>' + baseNotRecommend + "</strong></button>",
            "</div>",
            '<span class="vote-status" data-vote-status role="status" aria-live="polite">카카오 계정당 1표 · 다시 누르면 취소</span>',
            "</div>"
        ].join("");
    }

    function getVoteToken() {
        return window.GoyoungoAuth && typeof window.GoyoungoAuth.getAccessToken === "function"
            ? window.GoyoungoAuth.getAccessToken()
            : null;
    }

    function controlsForVenue(venueId) {
        return Array.from(root.querySelectorAll("[data-vote-control]")).filter(function (control) {
            return control.dataset.venueId === venueId;
        });
    }

    function numberOrZero(value) {
        var number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
    }

    function defaultVoteState() {
        return {
            recommend: 0,
            notRecommend: 0,
            userChoice: null,
            loading: false,
            message: "",
            revision: 0,
            readRequest: 0
        };
    }

    function restaurantVoteTotals(item) {
        var live = voteState.get(item.id) || defaultVoteState();
        var recommend = (Array.isArray(item.recommenders) ? item.recommenders.length : 0) +
            numberOrZero(live.recommend);
        var notRecommend = (Array.isArray(item.detractors) ? item.detractors.length : 0) +
            numberOrZero(live.notRecommend);
        return {
            recommend: recommend,
            notRecommend: notRecommend,
            score: recommend - notRecommend
        };
    }

    function rankedRestaurants(page, type) {
        return page.sections.reduce(function (items, section) {
            return items.concat(section.items || []);
        }, []).map(function (item) {
            return { item: item, totals: restaurantVoteTotals(item) };
        }).filter(function (entry) {
            return entry.totals[type] > 0;
        }).sort(function (left, right) {
            var countDifference = right.totals[type] - left.totals[type];
            if (countDifference) return countDifference;
            var scoreDifference = type === "recommend"
                ? right.totals.score - left.totals.score
                : left.totals.score - right.totals.score;
            if (scoreDifference) return scoreDifference;
            return left.item.name.localeCompare(right.item.name, "ko-KR");
        }).slice(0, 10);
    }

    function rankingListHtml(entries, type) {
        if (!entries.length) {
            return '<p class="ranking-empty">아직 집계된 평가가 없습니다.</p>';
        }
        var label = type === "recommend" ? "추천" : "비추천";
        return '<ol class="ranking-list">' + entries.map(function (entry, index) {
            return [
                "<li>",
                '<button type="button" class="ranking-item" data-ranking-venue="' +
                    esc(entry.item.id) + '">',
                '<span class="ranking-position">' + (index + 1) + "</span>",
                '<span class="ranking-name">' + esc(entry.item.name) + "</span>",
                '<span class="ranking-count">' + entry.totals[type] + " " + label + "</span>",
                "</button>",
                "</li>"
            ].join("");
        }).join("") + "</ol>";
    }

    function restaurantRankingsHtml(page) {
        return [
            '<section class="restaurant-rankings" data-restaurant-rankings aria-labelledby="rankingTitle">',
            '<div class="ranking-heading">',
            '<div><span class="eyebrow">LIVE RANKING</span>',
            '<h2 id="rankingTitle">맛집 추천·비추천 순위</h2></div>',
            "<p>현재 페이지의 평가를 실시간으로 집계한 TOP 10입니다.</p>",
            "</div>",
            '<div class="ranking-grid">',
            '<article class="ranking-panel is-recommend">',
            "<h3><span aria-hidden=\"true\">👍</span> 추천 순위</h3>",
            rankingListHtml(rankedRestaurants(page, "recommend"), "recommend"),
            "</article>",
            '<article class="ranking-panel is-not-recommend">',
            "<h3><span aria-hidden=\"true\">👎</span> 비추천 순위</h3>",
            rankingListHtml(rankedRestaurants(page, "notRecommend"), "notRecommend"),
            "</article>",
            "</div>",
            "</section>"
        ].join("");
    }

    function renderRestaurantRankings() {
        if (!rankingPage) return;
        var current = root.querySelector("[data-restaurant-rankings]");
        if (!current) return;
        var holder = document.createElement("div");
        holder.innerHTML = restaurantRankingsHtml(rankingPage);
        current.replaceWith(holder.firstElementChild);
    }

    function scheduleRankingRender() {
        if (!rankingPage || rankingRenderPending) return;
        rankingRenderPending = true;
        window.setTimeout(function () {
            rankingRenderPending = false;
            renderRestaurantRankings();
        }, 0);
    }

    function voteStatusMessage(state) {
        if (state.message) return state.message;
        if (state.userChoice === "recommend") return "추천했습니다 · 다시 누르면 취소";
        if (state.userChoice === "not_recommend") return "비추천했습니다 · 다시 누르면 취소";
        return "카카오 계정당 1표 · 다시 누르면 취소";
    }

    function renderVoteState(venueId) {
        var state = voteState.get(venueId) || defaultVoteState();

        controlsForVenue(venueId).forEach(function (control) {
            var baseRecommend = numberOrZero(control.dataset.baseRecommend);
            var baseNotRecommend = numberOrZero(control.dataset.baseNotRecommend);
            var recommend = baseRecommend + numberOrZero(state.recommend);
            var notRecommend = baseNotRecommend + numberOrZero(state.notRecommend);
            var score = recommend - notRecommend;
            var scoreElement = control.querySelector("[data-score]");
            var recommendElement = control.querySelector("[data-recommend-count]");
            var notRecommendElement = control.querySelector("[data-not-recommend-count]");
            var statusElement = control.querySelector("[data-vote-status]");

            if (scoreElement) {
                scoreElement.textContent = (score > 0 ? "+" : "") + score;
                scoreElement.classList.toggle("positive", score > 0);
                scoreElement.classList.toggle("negative", score < 0);
            }
            if (recommendElement) recommendElement.textContent = String(recommend);
            if (notRecommendElement) notRecommendElement.textContent = String(notRecommend);
            if (statusElement) statusElement.textContent = voteStatusMessage(state);

            control.classList.toggle("is-loading", state.loading);
            control.setAttribute("aria-busy", state.loading ? "true" : "false");
            control.querySelectorAll("[data-vote-choice]").forEach(function (button) {
                var selected = state.userChoice === button.dataset.voteChoice;
                button.setAttribute("aria-pressed", selected ? "true" : "false");
                button.disabled = state.loading;
            });
        });
    }

    function updateVoteState(venueId, values) {
        var current = voteState.get(venueId) || defaultVoteState();
        voteState.set(venueId, Object.assign({}, current, values));
        renderVoteState(venueId);
        scheduleRankingRender();
    }

    async function loadVotes(venueIds) {
        if (!voteApiUrl || !venueIds.length || localPreview) return false;
        if (venueIds.length > 50) {
            var batches = [];
            for (var offset = 0; offset < venueIds.length; offset += 50) {
                batches.push(venueIds.slice(offset, offset + 50));
            }
            var batchResults = await Promise.all(batches.map(function (batch) {
                return loadVotes(batch);
            }));
            return batchResults.some(Boolean);
        }

        var requestId = ++voteReadSequence;
        var authEpoch = voteAuthEpoch;
        var token = getVoteToken();
        var headers = token ? { Authorization: "Bearer " + token } : {};
        var revisions = new Map();
        var applied = 0;

        venueIds.forEach(function (venueId) {
            var current = voteState.get(venueId) || defaultVoteState();
            revisions.set(venueId, current.revision);
            updateVoteState(venueId, {
                readRequest: requestId,
                loading: Boolean(token),
                message: ""
            });
        });

        try {
            var response = await fetch(
                voteApiUrl + "/votes?venueIds=" + encodeURIComponent(venueIds.join(",")),
                { method: "GET", headers: headers, credentials: "omit" }
            );
            if (!response.ok) {
                var error = new Error("Vote read failed");
                error.status = response.status;
                throw error;
            }

            var payload = await response.json();
            if (authEpoch !== voteAuthEpoch) return false;

            venueIds.forEach(function (venueId) {
                var current = voteState.get(venueId) || defaultVoteState();
                if (
                    current.readRequest !== requestId ||
                    current.revision !== revisions.get(venueId)
                ) return;

                var item = payload.votes && payload.votes[venueId] ? payload.votes[venueId] : {};
                updateVoteState(venueId, {
                    recommend: numberOrZero(item.recommend),
                    notRecommend: numberOrZero(item.notRecommend),
                    userChoice: item.userChoice === "recommend" || item.userChoice === "not_recommend"
                        ? item.userChoice
                        : null,
                    loading: false,
                    message: ""
                });
                applied += 1;
            });
            return applied > 0;
        } catch (error) {
            if (authEpoch !== voteAuthEpoch) return false;
            if (
                error.status === 401 &&
                token &&
                window.GoyoungoAuth &&
                typeof window.GoyoungoAuth.invalidateSession === "function"
            ) {
                window.GoyoungoAuth.invalidateSession();
                window.setTimeout(function () { loadVotes(venueIds); }, 0);
                return false;
            }
            var message = error.status === 401
                ? "로그인이 만료되었습니다. 다시 로그인해 주세요."
                : "평가 정보를 불러오지 못했습니다.";
            venueIds.forEach(function (venueId) {
                var current = voteState.get(venueId) || defaultVoteState();
                if (
                    current.readRequest !== requestId ||
                    current.revision !== revisions.get(venueId)
                ) return;
                updateVoteState(venueId, { loading: false, message: message });
            });
            return false;
        }
    }

    async function submitVote(venueId, choice) {
        var token = getVoteToken();
        if (!token) {
            updateVoteState(venueId, { message: "카카오 로그인이 필요합니다." });
            if (window.GoyoungoAuth && typeof window.GoyoungoAuth.requestLogin === "function") {
                window.GoyoungoAuth.requestLogin(
                    "추천·비추천 평가를 남기려면 카카오 로그인이 필요합니다.",
                    function () {
                        updateVoteState(venueId, { loading: false });
                        submitVote(venueId, choice);
                    }
                );
            }
            return;
        }

        var current = voteState.get(venueId) || defaultVoteState();
        if (current.loading) return;
        var authEpoch = voteAuthEpoch;
        var writeRevision = current.revision + 1;
        var nextChoice = current.userChoice === choice ? null : choice;
        updateVoteState(venueId, {
            loading: true,
            message: "평가를 저장하는 중…",
            revision: writeRevision
        });

        try {
            var response = await fetch(voteApiUrl + "/votes/" + encodeURIComponent(venueId), {
                method: "PUT",
                headers: {
                    Authorization: "Bearer " + token,
                    "Content-Type": "application/json"
                },
                credentials: "omit",
                body: JSON.stringify({ choice: nextChoice })
            });
            var payload = await response.json().catch(function () { return {}; });
            var latest = voteState.get(venueId) || defaultVoteState();
            if (authEpoch !== voteAuthEpoch || latest.revision !== writeRevision) return;

            if (response.status === 409) {
                var refreshed = await loadVotes([venueId]);
                latest = voteState.get(venueId) || defaultVoteState();
                if (
                    refreshed &&
                    authEpoch === voteAuthEpoch &&
                    latest.revision === writeRevision
                ) {
                    updateVoteState(venueId, { message: "다른 화면의 변경을 반영했습니다. 다시 선택해 주세요." });
                }
                return;
            }
            if (!response.ok) {
                var error = new Error("Vote write failed");
                error.status = response.status;
                throw error;
            }

            updateVoteState(venueId, {
                recommend: numberOrZero(payload.recommend),
                notRecommend: numberOrZero(payload.notRecommend),
                userChoice: payload.userChoice === "recommend" || payload.userChoice === "not_recommend"
                    ? payload.userChoice
                    : null,
                loading: false,
                message: ""
            });
        } catch (error) {
            var latest = voteState.get(venueId) || defaultVoteState();
            if (authEpoch !== voteAuthEpoch || latest.revision !== writeRevision) return;
            if (
                error.status === 401 &&
                window.GoyoungoAuth &&
                typeof window.GoyoungoAuth.reauthenticate === "function"
            ) {
                updateVoteState(venueId, {
                    loading: false,
                    message: "로그인이 만료되었습니다. 다시 로그인해 주세요."
                });
                window.GoyoungoAuth.reauthenticate(
                    "추천·비추천 평가를 남기려면 카카오 로그인을 다시 해주세요.",
                    function () {
                        updateVoteState(venueId, { loading: false });
                        submitVote(venueId, choice);
                    }
                );
                return;
            }
            updateVoteState(venueId, {
                loading: false,
                message: "평가를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
            });
        }
    }

    function bindVenueVoting(page) {
        voteVenueIds = Array.from(new Set(page.sections.reduce(function (ids, section) {
            return ids.concat(section.items.filter(function (item) {
                return item.votingEnabled !== false;
            }).map(function (item) {
                return item.id;
            }));
        }, [])));

        voteVenueIds.forEach(function (venueId) {
            updateVoteState(venueId, {
                message: localPreview ? "운영 사이트에서 평가할 수 있습니다." : ""
            });
        });

        root.addEventListener("click", function (event) {
            var button = event.target.closest("[data-vote-choice]");
            if (!button || !root.contains(button)) return;
            var control = button.closest("[data-vote-control]");
            if (!control) return;
            submitVote(control.dataset.venueId, button.dataset.voteChoice);
        });

        document.addEventListener("goyoungo:authchange", function (event) {
            var authenticated = event.detail && event.detail.authenticated;
            voteAuthEpoch += 1;
            voteVenueIds.forEach(function (venueId) {
                var current = voteState.get(venueId) || defaultVoteState();
                updateVoteState(venueId, {
                    userChoice: null,
                    loading: false,
                    message: localPreview ? "운영 사이트에서 평가할 수 있습니다." : "",
                    revision: current.revision + 1,
                    readRequest: 0
                });
            });
            if (authenticated && !localPreview) loadVotes(voteVenueIds);
        });

        if (!localPreview) loadVotes(voteVenueIds);
    }

    function restaurantSearchText(item) {
        return [
            item.name,
            item.menus.join(" "),
            item.address,
            item.phone,
            item.note,
            item.hours
        ].join(" ").toLocaleLowerCase("ko-KR");
    }

    function restaurantMapUrl(item) {
        if (item.naverUrl) return item.naverUrl;
        var query = [item.name, item.address].filter(Boolean).join(" ");
        return "https://map.naver.com/p/search/" + encodeURIComponent(query);
    }

    function restaurantAddressHtml(item) {
        var address = item.address ? esc(item.address) : '<span class="faint">주소 미등록</span>';
        var mapLink = externalLink(
            restaurantMapUrl(item),
            "네이버지도",
            "venue-map-link"
        );
        var driveTime = item.driveMinutes
            ? '<span class="drive-time-badge">' + esc(item.driveFrom || "리조트") +
                "에서 차량 약 " + esc(item.driveMinutes) + "분</span>"
            : "";
        return '<span class="venue-address">' + address + "</span>" +
            '<span class="venue-map-action">📍 ' + mapLink + "</span>" + driveTime;
    }

    function restaurantRow(item) {
        return [
            '<tr data-venue="' + esc(item.id) + '" data-search="' + esc(restaurantSearchText(item)) + '">',
            '<td class="venue-name">' + esc(item.name) + "</td>",
            '<td class="menu-cell">' + tagsHtml(item.menus) + "</td>",
            '<td class="address-cell">' + restaurantAddressHtml(item) + "</td>",
            '<td class="phone-cell">' + phoneLink(item.phone) + "</td>",
            '<td class="score-cell">' + scoreHtml(item) + "</td>",
            '<td class="note-cell">' + textOrDash(item.note) + "</td>",
            '<td class="hours-cell">' + textOrDash(item.hours) + "</td>",
            "</tr>"
        ].join("");
    }

    function restaurantCard(item) {
        var meta = "";
        if (item.address || item.driveMinutes) {
            meta += '<p class="venue-address-line"><span aria-hidden="true">📍</span><span>' +
                restaurantAddressHtml(item) + "</span></p>";
        }
        if (item.phone) meta += "<p>☎️ " + phoneLink(item.phone) + "</p>";
        if (item.hours) meta += "<p>🕒 " + esc(item.hours) + "</p>";
        if (item.note) meta += "<p>💬 " + esc(item.note) + "</p>";
        return [
            '<article class="venue-card" data-venue="' + esc(item.id) + '" data-search="' + esc(restaurantSearchText(item)) + '">',
            "<h3>" + esc(item.name) + "</h3>",
            tagsHtml(item.menus),
            '<div class="venue-meta">' + meta + "</div>",
            '<div class="venue-score">' + scoreHtml(item) + "</div>",
            "</article>"
        ].join("");
    }

    function restaurantSection(section) {
        if (!section.items.length) return "";
        return [
            '<section class="data-section" data-section="' + esc(section.id) + '">',
            '<h2 class="data-section-title">' + esc(section.title) +
                '<span class="count-badge" data-section-count>' + section.items.length + "</span></h2>",
            '<div class="data-table-wrap" tabindex="0" role="region" aria-label="' + esc(section.title) + ' 맛집 표">',
            '<table class="data-table"><caption class="visually-hidden">' + esc(section.title) + " 맛집 목록</caption>",
            "<thead><tr>",
            '<th scope="col">이름</th><th scope="col">메뉴 및 기타</th><th scope="col">주소</th>',
            '<th scope="col">연락처</th><th scope="col">평가</th><th scope="col">메모</th><th scope="col">영업 시간</th>',
            "</tr></thead><tbody>",
            section.items.map(restaurantRow).join(""),
            "</tbody></table></div>",
            '<div class="mobile-cards">' + section.items.map(restaurantCard).join("") + "</div>",
            "</section>"
        ].join("");
    }

    function bindRestaurantSearch(total) {
        var input = document.getElementById("venueSearch");
        var result = document.getElementById("resultCount");
        var noResults = document.getElementById("searchEmpty");
        if (!input || !result) return;

        input.addEventListener("input", function () {
            var query = input.value.trim().toLocaleLowerCase("ko-KR");
            var matchedIds = new Set();

            document.querySelectorAll("[data-venue]").forEach(function (element) {
                var matches = !query || (element.dataset.search || "").includes(query);
                element.hidden = !matches;
                if (matches) matchedIds.add(element.dataset.venue);
            });

            document.querySelectorAll("[data-section]").forEach(function (section) {
                var rows = Array.from(section.querySelectorAll("tbody [data-venue]"));
                var count = rows.filter(function (row) { return !row.hidden; }).length;
                section.hidden = count === 0;
                var badge = section.querySelector("[data-section-count]");
                if (badge) badge.textContent = String(count);
            });

            result.innerHTML = "<strong>" + matchedIds.size + "</strong> / " + total + "곳";
            noResults.hidden = matchedIds.size !== 0;
        });
    }

    function bindRankingNavigation() {
        root.addEventListener("click", function (event) {
            var button = event.target.closest("[data-ranking-venue]");
            if (!button || !root.contains(button)) return;
            var venueId = button.dataset.rankingVenue;
            var input = document.getElementById("venueSearch");
            if (input && input.value) {
                input.value = "";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
            window.setTimeout(function () {
                var targets = Array.from(root.querySelectorAll("[data-venue]")).filter(function (element) {
                    return element.dataset.venue === venueId;
                });
                var target = targets.find(function (element) {
                    return !element.hidden && element.offsetParent !== null;
                }) || targets[0];
                if (!target) return;
                target.scrollIntoView({ behavior: "smooth", block: "center" });
                target.classList.add("ranking-target");
                window.setTimeout(function () {
                    target.classList.remove("ranking-target");
                }, 1_600);
            }, 0);
        });
    }

    function renderRestaurants(page) {
        var total = page.sections.reduce(function (sum, section) {
            return sum + section.items.length;
        }, 0);
        rankingPage = total ? page : null;
        document.title = page.title + " - " + data.brand.title;
        var menuDisclosure = page.naverSource && page.naverSource.menuSnapshotDate ? [
            "<p><strong>네이버 플레이스 메뉴판</strong>을 ",
            esc(page.naverSource.menuSnapshotDate) + " 기준으로 확인해 ",
            esc(page.naverSource.menuPlacesWithMenus) + "곳의 대표 메뉴를 최대 5개까지 반영했습니다. ",
            "메뉴와 가격은 매장 사정에 따라 달라질 수 있습니다.</p>"
        ].join("") : "";
        var sourceDisclosure = page.naverSource ? [
            '<aside class="restaurant-source-note">',
            "<p><strong>네이버 지도</strong> 기준으로 이 리조트 주변 " +
                esc(page.naverSource.importedCount) + "곳의 정보를 반영했습니다.</p>",
            "<p>표시된 차량 시간은 " + esc(page.naverSource.routeBasis) +
                "으로, 실제 교통 상황과 경로에 따라 달라질 수 있습니다. " +
                externalLink(page.naverSource.url, "네이버 지도에서 확인", "text-link") + "</p>",
            menuDisclosure,
            data.config && data.config.importedVotingEnabled ? "" :
                "<p>신규 등록 장소의 추천·비추천 평가는 서버 연동을 준비 중입니다.</p>",
            "</aside>"
        ].join("") : "";

        var content = total ? [
            '<div class="toolbar">',
            '<div class="search-field"><label for="venueSearch">맛집 검색</label>',
            '<input id="venueSearch" type="search" placeholder="이름, 메뉴, 주소로 검색" autocomplete="off"></div>',
            '<div class="result-count" id="resultCount" role="status" aria-live="polite"><strong>' +
                total + "</strong> / " + total + "곳</div>",
            "</div>",
            sourceDisclosure,
            restaurantRankingsHtml(page),
            page.sections.map(restaurantSection).join(""),
            '<div class="empty-state" id="searchEmpty" hidden>',
            '<span aria-hidden="true">🔎</span><h2>검색 결과가 없습니다</h2><p>다른 이름이나 메뉴로 검색해 보세요.</p>',
            "</div>"
        ].join("") : [
            '<div class="empty-state">',
            '<span aria-hidden="true">🍽️</span>',
            "<h2>등록된 맛집 정보가 아직 없습니다</h2>",
            "<p>원본 데이터에 유효한 항목이 추가되면 이 페이지에도 반영할 수 있습니다.</p>",
            "</div>"
        ].join("");

        root.innerHTML = '<div class="page-wrap">' + hero(page) + content + footer() + "</div>";
        bindRestaurantSearch(total);
        bindRankingNavigation();
        if (total) bindVenueVoting(page);
    }

    function renderMarket(page) {
        document.title = page.title + " - " + data.brand.title;
        var cards = page.items.map(function (item) {
            return [
                '<article class="content-card">',
                '<div class="card-topline"><h2>' + esc(item.name) + '</h2><span class="status-pill ' +
                    (item.status === "팝니다" ? "sell" : "buy") + '">' + esc(item.status) + "</span></div>",
                '<p class="price">' + esc(item.price) + "</p>",
                tagsHtml(item.categories),
                '<dl class="meta-list">',
                '<div class="meta-row"><dt>거래 장소</dt><dd>' + textOrDash(item.location) + "</dd></div>",
                '<div class="meta-row"><dt>톡방</dt><dd>' + textOrDash(item.chatRooms.join(", ")) + "</dd></div>",
                '<div class="meta-row"><dt>판매/구매자</dt><dd>' + textOrDash(item.member) + "</dd></div>",
                '<div class="meta-row"><dt>연락처</dt><dd>' + phoneLink(item.phone) + "</dd></div>",
                "</dl>",
                item.detailUrl ? '<div class="card-actions">' + externalLink(item.detailUrl, "상품 정보 보기", "action-link primary") + "</div>" : "",
                '<p class="updated-at">마지막 업데이트 · ' + esc(item.updatedAt) + "</p>",
                "</article>"
            ].join("");
        }).join("");
        root.innerHTML = '<div class="page-wrap">' + hero(page) + '<div class="card-grid">' + cards + "</div>" + footer() + "</div>";
    }

    function seasonContact(contact) {
        if (!contact) return '<span class="faint">—</span>';
        var match = contact.match(/0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/);
        return match ? phoneLink(match[0], contact) : esc(contact);
    }

    function renderSeason(page) {
        document.title = page.title + " - " + data.brand.title;
        var cards = page.items.map(function (item) {
            var instagram = item.links.find(function (link) { return /instagram\.com/i.test(link); });
            var otherLinks = item.links.filter(function (link) { return !/instagram\.com/i.test(link); });
            var sns = item.sns
                ? (instagram ? externalLink(instagram, item.sns) : esc(item.sns))
                : '<span class="faint">—</span>';
            return [
                '<article class="content-card">',
                '<div class="card-topline"><h2>' + esc(item.name) + '</h2><span class="status-pill ' +
                    (item.status === "완료" ? "done" : "") + '">' + esc(item.status) + "</span></div>",
                '<p class="price">' + esc(item.type) + "</p>",
                '<dl class="meta-list">',
                '<div class="meta-row"><dt>연락처</dt><dd>' + seasonContact(item.contact) + "</dd></div>",
                '<div class="meta-row"><dt>SNS</dt><dd>' + sns + "</dd></div>",
                '<div class="meta-row"><dt>모집 성별</dt><dd>' + textOrDash(item.gender.join(", ")) + "</dd></div>",
                '<div class="meta-row"><dt>금액</dt><dd>' + textOrDash(item.price) + "</dd></div>",
                "</dl>",
                item.details ? '<p class="detail-text">' + esc(item.details) + "</p>" : "",
                otherLinks.length ? '<div class="card-actions">' + otherLinks.map(function (link) {
                    return externalLink(link, "상세 게시글", "action-link");
                }).join("") + "</div>" : "",
                '<p class="updated-at">마지막 업데이트 · ' + esc(item.updatedAt) + "</p>",
                "</article>"
            ].join("");
        }).join("");
        root.innerHTML = '<div class="page-wrap">' + hero(page) + '<div class="card-grid">' + cards + "</div>" + footer() + "</div>";
    }

    function renderPartner(page) {
        var company = page.company;
        document.title = page.title + " - " + data.brand.title;
        var products = page.products.map(function (product) {
            return [
                '<article class="product-card">',
                '<div class="product-icon" aria-hidden="true">' + esc(product.icon) + "</div>",
                "<h3>" + esc(product.name) + "</h3>",
                tagsHtml(product.tags),
                product.price !== null ? '<p class="product-price">' + formatMoney(product.price) + "</p>" : "",
                product.benefit ? '<p class="product-benefit">' + esc(product.benefit) + "</p>" : "",
                "</article>"
            ].join("");
        }).join("");

        root.innerHTML = [
            '<div class="page-wrap">',
            hero(page),
            '<section class="partner-layout" aria-label="제휴 업체 정보">',
            '<div class="partner-photo"><img src="' + esc(company.imageUrl) + '" alt="웰리힐리파크 보드카페 전경"></div>',
            '<div class="company-card"><h2>' + esc(company.name) + "</h2>",
            '<dl class="meta-list">',
            '<div class="meta-row"><dt>주소</dt><dd>' + esc(company.address) + "</dd></div>",
            '<div class="meta-row"><dt>연락처</dt><dd>' + phoneLink(company.phone) + "</dd></div>",
            '<div class="meta-row"><dt>지도</dt><dd>' + externalLink(company.mapUrl, "네이버 지도에서 보기") + "</dd></div>",
            "</dl>",
            '<div class="key-phrases"><p>방문할 때 이렇게 말씀해 주세요</p>' + tagsHtml(company.key) + "</div>",
            "</div></section>",
            '<section class="product-section" aria-labelledby="productsTitle">',
            '<h2 class="section-heading" id="productsTitle">제휴 상품</h2>',
            '<div class="product-grid">' + products + "</div></section>",
            footer(),
            "</div>"
        ].join("");
    }

    function renderShuttle(page) {
        document.title = page.title + " - " + data.brand.title;
        var items = page.items.map(function (item) {
            return [
                '<article class="shuttle-item">',
                '<div class="shuttle-copy"><div>',
                item.eyebrow ? '<p class="eyebrow">' + esc(item.eyebrow) + "</p>" : "",
                "<h2>" + esc(item.title) + "</h2>",
                "<p>" + esc(item.description) + "</p>",
                "</div>",
                externalLink(item.url, "예약 페이지 열기 ↗", "action-link primary"),
                "</div>",
                '<img class="shuttle-image" src="' + esc(item.image) + '" alt="' + esc(item.description) + '" loading="lazy">',
                "</article>"
            ].join("");
        }).join("");
        root.innerHTML = '<div class="page-wrap narrow">' + hero(page) + '<div class="shuttle-list">' + items + "</div>" + footer() + "</div>";
    }

    function renderUnknown() {
        document.title = "페이지를 찾을 수 없습니다 - " + data.brand.title;
        root.innerHTML = [
            '<div class="page-wrap narrow">',
            '<a class="back-link" href="/index.html">← 홈으로</a>',
            '<div class="empty-state"><span aria-hidden="true">🏔️</span>',
            "<h1>페이지를 찾을 수 없습니다</h1><p>홈에서 원하는 정보를 다시 선택해 주세요.</p></div>",
            "</div>"
        ].join("");
    }

    function renderCurrentPage() {
        var pageId = document.body.dataset.page || "home";
        if (pageId === "home") {
            renderHome();
            return;
        }

        var page = data.pages[pageId];
        if (!page) {
            renderUnknown();
        } else if (page.type === "restaurants") {
            renderRestaurants(page);
        } else if (page.type === "market") {
            renderMarket(page);
        } else if (page.type === "season") {
            renderSeason(page);
        } else if (page.type === "partner") {
            renderPartner(page);
        } else if (page.type === "shuttle") {
            renderShuttle(page);
        } else {
            renderUnknown();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", renderCurrentPage, { once: true });
    } else {
        renderCurrentPage();
    }
})();
