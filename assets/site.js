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
    var currentRestaurantPage = null;
    var currentMarketPage = null;
    var adminState = { isAdmin: false, checking: false };
    var adminControlsBound = false;
    var marketAdminBound = false;
    var marketNotice = "";
    var voteControlsBound = false;
    var voteAuthBound = false;
    var rankingControlsBound = false;
    var localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
        new URLSearchParams(window.location.search).has("preview");

    function normalizeVenueName(value) {
        var aliases = {
            "고향막국수": "봉평고향막국수",
            "둔내웅이네": "웅이네",
            "문화정육점생고기숯불구이": "문화정육점",
            "평창한우다래": "다래",
            "싼타클로스버거": "싼타버거",
            "cafe싼타수제버거": "싼타버거",
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

    function importedRecommendationCount(item) {
        return numberOrZero(item.memoRecommendCount);
    }

    function mergeImportedRestaurants() {
        var imported = window.NAVER_RESTAURANTS;
        if (!imported || !imported.pages) return;

        var resortNames = {
            welpark: "웰리힐리파크",
            phoenix: "휘닉스 평창",
            yongpyong: "모나 용평",
            high1: "하이원리조트",
            konjiam: "곤지암리조트",
            jisan: "지산포레스트리조트",
            o2: "오투리조트",
            vivaldi: "비발디파크",
            yangji: "양지파인",
            elysian: "엘리시안 강촌",
            muju: "무주덕유산리조트"
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
                    memoRecommendCount: sourceItem.memoRecommendCount,
                    votingEnabled: sourceItem.votingEnabled !== false &&
                        Boolean(data.config && data.config.importedVotingEnabled)
                };

                if (existing) {
                    delete importedFields.votingEnabled;
                    Object.assign(existing, importedFields);
                    existing.menus = mergeMenuTags(sourceMenus, existing.menus);
                    if (!existing.address) existing.address = sourceItem.address;
                    if (!existing.phone && sourceItem.phone) existing.phone = sourceItem.phone;
                    if (!existing.hours && sourceItem.hours) existing.hours = sourceItem.hours;
                    if (!existing.note && sourceItem.memo) existing.note = sourceItem.memo;
                    return;
                }

                var newItem = Object.assign({
                    id: "naver-" + sourceItem.naverId,
                    name: sourceItem.name,
                    menus: sourceMenus,
                    address: sourceItem.address,
                    phone: sourceItem.phone || "",
                    recommenders: [],
                    detractors: [],
                    score: 0,
                    note: sourceItem.memo || "",
                    hours: sourceItem.hours || ""
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
                operatingCount: openSection.items.length,
                routeBasis: imported.source.routeBasis,
                menuSnapshotDate: imported.source.menuSource &&
                    imported.source.menuSource.snapshotDate,
                menuPlacesWithMenus: importedItems.filter(function (item) {
                    return Array.isArray(item.menus) && item.menus.length > 0;
                }).length,
                detailSnapshotDate: imported.source.detailSource &&
                    imported.source.detailSource.snapshotDate,
                placesWithPhone: importedItems.filter(function (item) {
                    return Boolean(item.phone);
                }).length,
                placesWithHours: importedItems.filter(function (item) {
                    return Boolean(item.hours);
                }).length
            };

            var operatingTotal = openSection.items.length;
            var navigationItem = data.navigation.find(function (item) {
                return item.id === pageId;
            });
            if (navigationItem) {
                navigationItem.summary = resortNames[pageId] + " 주변 맛집 " +
                    operatingTotal + "곳";
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

    function restaurantItems(page) {
        return page.sections.reduce(function (items, section) {
            return items.concat(section.items || []);
        }, []);
    }

    function findRestaurant(page, venueId) {
        return restaurantItems(page).find(function (item) { return item.id === venueId; }) || null;
    }

    function applyRestaurantOverride(page, venueId, fields) {
        var sourceSection = page.sections.find(function (section) {
            return (section.items || []).some(function (item) { return item.id === venueId; });
        });
        if (!sourceSection) return false;
        var itemIndex = sourceSection.items.findIndex(function (item) { return item.id === venueId; });
        var item = sourceSection.items[itemIndex];
        Object.keys(fields || {}).forEach(function (key) {
            if (key !== "status") item[key] = fields[key];
        });
        if (fields && (fields.status === "open" || fields.status === "closed") && sourceSection.id !== fields.status) {
            var targetSection = page.sections.find(function (section) { return section.id === fields.status; });
            if (targetSection) {
                sourceSection.items.splice(itemIndex, 1);
                targetSection.items.push(item);
            }
        }
        return true;
    }

    function updateOperatingCount(page) {
        if (!page.naverSource) return;
        var openSection = page.sections.find(function (section) { return section.id === "open"; });
        if (openSection) page.naverSource.operatingCount = openSection.items.length;
    }

    async function fetchJson(path, options) {
        var response = await fetch(voteApiUrl + path, options || {});
        var payload = {};
        try { payload = await response.json(); } catch (error) { payload = {}; }
        if (!response.ok) {
            var requestError = new Error(payload.message || "요청을 처리하지 못했습니다.");
            requestError.status = response.status;
            throw requestError;
        }
        return payload;
    }

    async function loadRestaurantOverrides(page) {
        if (!voteApiUrl || localPreview) return;
        var venueIds = restaurantItems(page).map(function (item) { return item.id; });
        for (var start = 0; start < venueIds.length; start += 50) {
            var chunk = venueIds.slice(start, start + 50);
            try {
                var payload = await fetchJson("/restaurant-overrides?venueIds=" + encodeURIComponent(chunk.join(",")));
                Object.keys(payload.overrides || {}).forEach(function (venueId) {
                    applyRestaurantOverride(page, venueId, payload.overrides[venueId].fields || {});
                });
            } catch (error) {
                console.warn("Restaurant overrides unavailable", error && error.message);
                break;
            }
        }
        updateOperatingCount(page);
    }

    function setAdminUi(isAdmin) {
        adminState.isAdmin = Boolean(isAdmin);
        document.body.toggleAttribute("data-site-admin", adminState.isAdmin);
        root.querySelectorAll("[data-admin-edit], [data-market-admin]").forEach(function (button) {
            button.hidden = !adminState.isAdmin;
        });
    }

    async function refreshAdminStatus() {
        var token = getVoteToken();
        if (!voteApiUrl || localPreview || !token || adminState.checking) {
            if (!token) setAdminUi(false);
            return;
        }
        adminState.checking = true;
        try {
            var payload = await fetchJson("/admin/me", {
                headers: { Authorization: "Bearer " + token }
            });
            setAdminUi(payload.isAdmin === true);
        } catch (error) {
            setAdminUi(false);
        } finally {
            adminState.checking = false;
        }
    }

    var restaurantPageIds = [
        "welpark", "phoenix", "yongpyong", "high1", "konjiam", "jisan",
        "o2", "vivaldi", "yangji", "elysian", "muju"
    ];

    function sidebarLinks(items, currentPageId) {
        return items.map(function (item) {
            var isCurrent = item.id === currentPageId;
            return [
                '<a class="site-sidebar-link' + (isCurrent ? " is-current" : "") + '" href="' + esc(item.href) + '"',
                isCurrent ? ' aria-current="page"' : "",
                ">",
                '<span aria-hidden="true">' + esc(item.icon || "•") + "</span>",
                "<span>" + esc(item.title) + "</span>",
                "</a>"
            ].join("");
        }).join("");
    }

    function createSiteNavigation(currentPageId) {
        if (document.getElementById("siteSidebar")) return;

        var shell = document.querySelector(".site-shell");
        var header = shell && shell.querySelector(".site-header");
        var main = shell && shell.querySelector(".page-root");
        if (!shell || !header || !main) return;

        var restaurantLinks = data.navigation.filter(function (item) {
            return restaurantPageIds.indexOf(item.id) !== -1;
        });
        var utilityLinks = data.navigation.filter(function (item) {
            return restaurantPageIds.indexOf(item.id) === -1;
        });

        var sidebar = document.createElement("aside");
        sidebar.id = "siteSidebar";
        sidebar.className = "site-sidebar";
        sidebar.setAttribute("aria-label", "SNOWBRO 전체 메뉴");
        sidebar.innerHTML = [
            '<div class="site-sidebar-inner">',
            '<a class="site-sidebar-home" href="/snowbro/">',
            '<span class="site-sidebar-mark" aria-hidden="true">SNOW</span>',
            '<span><strong>SNOWBRO</strong><small>스키장 정보 공유</small></span>',
            "</a>",
            '<button class="site-sidebar-collapse" type="button" aria-controls="siteSidebar" aria-expanded="true" aria-label="사이드바 접기" title="사이드바 접기">',
            '<span class="site-sidebar-collapse-icon" aria-hidden="true">&lsaquo;</span>',
            '<span class="site-sidebar-collapse-text">사이드바 접기</span>',
            "</button>",
            '<nav class="site-sidebar-nav" aria-label="SNOWBRO 페이지">',
            '<a class="site-sidebar-link site-sidebar-root' + (currentPageId === "home" ? " is-current" : "") + '" href="/snowbro/"' +
                (currentPageId === "home" ? ' aria-current="page"' : "") + ">",
            '<span aria-hidden="true">⌂</span><span>SNOWBRO 홈</span></a>',
            '<p class="site-sidebar-label">스키장 맛집</p>',
            sidebarLinks(restaurantLinks, currentPageId),
            '<p class="site-sidebar-label">기타 정보</p>',
            sidebarLinks(utilityLinks, currentPageId),
            '<p class="site-sidebar-label">GO.YOUNGO</p>',
            '<a class="site-sidebar-link" href="/runbro/"><span aria-hidden="true">R</span><span>RUNBRO</span></a>',
            '<a class="site-sidebar-link" href="/"><span aria-hidden="true">GO</span><span>메인으로</span></a>',
            "</nav>",
            "</div>"
        ].join("");
        shell.insertBefore(sidebar, main);

        var toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "site-nav-toggle";
        toggle.setAttribute("aria-controls", "siteSidebar");
        toggle.setAttribute("aria-expanded", "false");
        toggle.innerHTML = '<span aria-hidden="true">☰</span><span>메뉴</span>';

        var brand = header.querySelector(".brand-link");
        header.insertBefore(toggle, brand || header.firstChild);

        var backdrop = document.createElement("button");
        backdrop.type = "button";
        backdrop.className = "site-nav-backdrop";
        backdrop.setAttribute("aria-label", "메뉴 닫기");
        document.body.appendChild(backdrop);
        document.body.classList.add("has-site-sidebar");

        var collapse = sidebar.querySelector(".site-sidebar-collapse");

        function storedCollapsed() {
            try {
                return localStorage.getItem("goyoungo-sidebar-collapsed") === "true";
            } catch (error) {
                return false;
            }
        }

        function setCollapsed(collapsed) {
            document.body.classList.toggle("site-sidebar-collapsed", collapsed);
            collapse.setAttribute("aria-expanded", collapsed ? "false" : "true");
            collapse.setAttribute("aria-label", collapsed ? "사이드바 펼치기" : "사이드바 접기");
            collapse.setAttribute("title", collapsed ? "사이드바 펼치기" : "사이드바 접기");
            collapse.querySelector(".site-sidebar-collapse-icon").textContent = collapsed ? "›" : "‹";
            collapse.querySelector(".site-sidebar-collapse-text").textContent = collapsed ? "사이드바 펼치기" : "사이드바 접기";
            try {
                localStorage.setItem("goyoungo-sidebar-collapsed", collapsed ? "true" : "false");
            } catch (error) {
                // Sidebar preference is optional when storage is unavailable.
            }
        }

        setCollapsed(storedCollapsed());

        function setOpen(open) {
            document.body.classList.toggle("site-nav-open", open);
            toggle.setAttribute("aria-expanded", open ? "true" : "false");
        }

        toggle.addEventListener("click", function () {
            setOpen(!document.body.classList.contains("site-nav-open"));
        });
        collapse.addEventListener("click", function () {
            setCollapsed(!document.body.classList.contains("site-sidebar-collapsed"));
        });
        backdrop.addEventListener("click", function () {
            setOpen(false);
        });
        sidebar.addEventListener("click", function (event) {
            if (event.target.closest("a")) setOpen(false);
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") setOpen(false);
        });
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
            '<nav class="breadcrumbs" aria-label="현재 위치">',
            '<a href="/">GO.YOUNGO</a><span aria-hidden="true">›</span>',
            '<a href="/snowbro/">SNOWBRO</a><span aria-hidden="true">›</span>',
            '<span aria-current="page">' + esc(page.title) + "</span>",
            "</nav>",
            '<header class="page-hero">',
            '<div class="page-icon" aria-hidden="true">' + esc(page.icon) + "</div>",
            '<p class="eyebrow">GO.YOUNGO</p>',
            "<h1>" + esc(page.title) + "</h1>",
            "<p>" + esc(page.subtitle || "") + "</p>",
            '<p class="snapshot-note">마지막 정보 스냅샷 · ' + esc(data.brand.snapshotDate) + "</p>",
            "</header>"
        ].join("");
    }

    function footer() {
        return [
            '<footer class="source-footer">',
            "<strong>GO.YOUNGO</strong> · 보더와 스키어가 함께 정리한 snow bro 정보입니다. ",
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
            konjiam: "EAT",
            jisan: "EAT",
            o2: "EAT",
            vivaldi: "EAT",
            yangji: "EAT",
            elysian: "EAT",
            muju: "EAT",
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

        var restaurantTotal = Object.keys(data.pages).reduce(function (total, pageId) {
            var page = data.pages[pageId];
            if (!page || page.type !== "restaurants" || !Array.isArray(page.sections)) return total;
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
            '<p class="home-kicker">KOREA SNOW DIRECTORY · 2026</p>',
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
        var baseRecommend = item.recommenders.length + importedRecommendationCount(item);
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
            importedRecommendationCount(item) +
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

        if (!voteControlsBound) {
            voteControlsBound = true;
            root.addEventListener("click", function (event) {
                var button = event.target.closest("[data-vote-choice]");
                if (!button || !root.contains(button)) return;
                var control = button.closest("[data-vote-control]");
                if (!control) return;
                submitVote(control.dataset.venueId, button.dataset.voteChoice);
            });
        }

        if (!voteAuthBound) {
            voteAuthBound = true;
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
        }

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

    function adminActionsHtml(item) {
        return '<button class="admin-edit-button" type="button" data-admin-edit data-venue-id="' +
            esc(item.id) + '"' + (adminState.isAdmin ? "" : " hidden") + '>관리자 수정</button>';
    }

    function adminModalHtml() {
        return [
            '<div class="admin-modal" data-admin-modal hidden>',
            '<section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="adminDialogTitle">',
            '<div class="admin-dialog-head"><div><span class="eyebrow">ADMIN</span>',
            '<h2 id="adminDialogTitle">맛집 정보 수정</h2></div>',
            '<button class="admin-dialog-close" type="button" data-admin-close aria-label="수정 창 닫기">×</button></div>',
            '<form data-admin-form><input type="hidden" name="venueId">',
            '<div class="admin-form-grid">',
            '<label>업체명<input name="name" required maxlength="100"></label>',
            '<label>운영 상태<select name="status"><option value="open">운영 중</option><option value="closed">폐업</option></select></label>',
            '<label class="admin-form-wide">주소<input name="address" maxlength="300"></label>',
            '<label>연락처<input name="phone" maxlength="40" inputmode="tel"></label>',
            '<label>차량 이동(분)<input name="driveMinutes" type="number" min="0" max="300"></label>',
            '<label class="admin-form-wide">영업시간<textarea name="hours" maxlength="500"></textarea></label>',
            '<label class="admin-form-wide">대표 메뉴 (한 줄에 하나)<textarea name="menus" maxlength="1100"></textarea></label>',
            '<label class="admin-form-wide">메모<textarea name="note" maxlength="1000"></textarea></label>',
            '<label class="admin-form-wide">네이버 지도 링크<input name="naverUrl" type="url" maxlength="500" placeholder="https://map.naver.com/..."></label>',
            '</div>',
            '<div class="admin-form-actions">',
            '<button class="action-link primary" type="submit">저장</button>',
            '<button class="action-link" type="button" data-admin-history>변경 이력</button>',
            '<span class="admin-form-status" data-admin-status role="status" aria-live="polite"></span>',
            '</div></form>',
            '<section class="admin-history" data-admin-history-panel hidden aria-label="변경 이력"></section>',
            '</section></div>'
        ].join("");
    }

    function restaurantSectionId(page, venueId) {
        var section = page.sections.find(function (candidate) {
            return (candidate.items || []).some(function (item) { return item.id === venueId; });
        });
        return section && section.id === "closed" ? "closed" : "open";
    }

    function adminModal() {
        return root.querySelector("[data-admin-modal]");
    }

    function setAdminStatus(message, error) {
        var status = root.querySelector("[data-admin-status]");
        if (!status) return;
        status.textContent = message || "";
        status.classList.toggle("is-error", Boolean(error));
    }

    function closeAdminModal() {
        var modal = adminModal();
        if (!modal) return;
        modal.hidden = true;
        document.body.removeAttribute("data-admin-modal-open");
    }

    function openAdminModal(venueId) {
        if (!adminState.isAdmin || !currentRestaurantPage) return;
        var item = findRestaurant(currentRestaurantPage, venueId);
        var modal = adminModal();
        if (!item || !modal) return;
        var form = modal.querySelector("[data-admin-form]");
        form.elements.venueId.value = item.id;
        form.elements.name.value = item.name || "";
        form.elements.address.value = item.address || "";
        form.elements.phone.value = item.phone || "";
        form.elements.hours.value = item.hours || "";
        form.elements.menus.value = (item.menus || []).join("\n");
        form.elements.note.value = item.note || "";
        form.elements.driveMinutes.value = item.driveMinutes == null ? "" : item.driveMinutes;
        form.elements.status.value = restaurantSectionId(currentRestaurantPage, item.id);
        form.elements.naverUrl.value = item.naverUrl || "";
        modal.querySelector("[data-admin-history-panel]").hidden = true;
        modal.hidden = false;
        document.body.dataset.adminModalOpen = "true";
        setAdminStatus("", false);
        form.elements.name.focus();
    }

    function adminRequestOptions(body) {
        return {
            method: "PUT",
            headers: {
                Authorization: "Bearer " + getVoteToken(),
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        };
    }

    function handleAdminRequestError(error) {
        if (error && (error.status === 401 || error.status === 403)) {
            setAdminUi(false);
            if (error.status === 401 && window.GoyoungoAuth && typeof window.GoyoungoAuth.reauthenticate === "function") {
                window.GoyoungoAuth.reauthenticate("관리자 기능을 계속하려면 카카오 로그인을 다시 해주세요.");
            }
        }
        setAdminStatus(error && error.message ? error.message : "요청을 처리하지 못했습니다.", true);
    }

    async function saveAdminForm(form) {
        var venueId = form.elements.venueId.value;
        var submit = form.querySelector('[type="submit"]');
        var menus = form.elements.menus.value.split(/\n|,/).map(function (menu) {
            return menu.trim();
        }).filter(Boolean).slice(0, 10);
        var fields = {
            name: form.elements.name.value,
            address: form.elements.address.value,
            phone: form.elements.phone.value,
            hours: form.elements.hours.value,
            menus: menus,
            note: form.elements.note.value,
            driveMinutes: form.elements.driveMinutes.value === "" ? null : Number(form.elements.driveMinutes.value),
            status: form.elements.status.value,
            naverUrl: form.elements.naverUrl.value
        };
        submit.disabled = true;
        setAdminStatus("저장 중…", false);
        try {
            var payload = await fetchJson("/admin/restaurants/" + encodeURIComponent(venueId), adminRequestOptions({ fields: fields }));
            applyRestaurantOverride(currentRestaurantPage, venueId, payload.fields || fields);
            updateOperatingCount(currentRestaurantPage);
            closeAdminModal();
            renderRestaurants(currentRestaurantPage);
            setAdminUi(true);
        } catch (error) {
            handleAdminRequestError(error);
        } finally {
            submit.disabled = false;
        }
    }

    async function loadAdminHistory(venueId) {
        var panel = root.querySelector("[data-admin-history-panel]");
        if (!panel) return;
        panel.hidden = false;
        panel.innerHTML = '<p class="admin-history-empty">변경 이력을 불러오는 중…</p>';
        try {
            var payload = await fetchJson("/admin/restaurants/" + encodeURIComponent(venueId) + "/history", {
                headers: { Authorization: "Bearer " + getVoteToken() }
            });
            var history = payload.history || [];
            panel.innerHTML = history.length ? '<h3>최근 변경 이력</h3><ol>' + history.map(function (entry) {
                var changed = Object.keys(entry.after || {}).join(", ") || "초기 상태";
                return '<li><div><strong>' + esc(new Date(entry.updatedAt).toLocaleString("ko-KR")) +
                    '</strong><span>' + esc(changed) + '</span></div><button type="button" data-admin-restore="' +
                    esc(entry.revision) + '">이 변경 전으로 복원</button></li>';
            }).join("") + "</ol>" : '<p class="admin-history-empty">아직 변경 이력이 없습니다.</p>';
        } catch (error) {
            panel.innerHTML = '<p class="admin-history-empty">' + esc(error.message) + "</p>";
            handleAdminRequestError(error);
        }
    }

    async function restoreAdminRevision(venueId, revision, button) {
        button.disabled = true;
        setAdminStatus("이전 정보로 복원 중…", false);
        try {
            var payload = await fetchJson("/admin/restaurants/" + encodeURIComponent(venueId), adminRequestOptions({
                restoreRevision: revision
            }));
            applyRestaurantOverride(currentRestaurantPage, venueId, payload.fields || {});
            updateOperatingCount(currentRestaurantPage);
            closeAdminModal();
            renderRestaurants(currentRestaurantPage);
            setAdminUi(true);
        } catch (error) {
            button.disabled = false;
            handleAdminRequestError(error);
        }
    }

    function bindAdminControls() {
        if (adminControlsBound) return;
        adminControlsBound = true;
        root.addEventListener("click", function (event) {
            var edit = event.target.closest("[data-admin-edit]");
            if (edit) {
                openAdminModal(edit.dataset.venueId);
                return;
            }
            if (event.target.closest("[data-admin-close]") || event.target.matches("[data-admin-modal]")) {
                closeAdminModal();
                return;
            }
            var history = event.target.closest("[data-admin-history]");
            if (history) {
                var form = root.querySelector("[data-admin-form]");
                if (form) loadAdminHistory(form.elements.venueId.value);
                return;
            }
            var restore = event.target.closest("[data-admin-restore]");
            if (restore) {
                var restoreForm = root.querySelector("[data-admin-form]");
                if (restoreForm) restoreAdminRevision(restoreForm.elements.venueId.value, restore.dataset.adminRestore, restore);
            }
        });
        root.addEventListener("submit", function (event) {
            var form = event.target.closest("[data-admin-form]");
            if (!form) return;
            event.preventDefault();
            saveAdminForm(form);
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && adminModal() && !adminModal().hidden) closeAdminModal();
        });
    }

    function restaurantCategory(item) {
        var text = restaurantSearchText(item);
        if (/(카페|커피|베이커리|디저트|도넛|라떼|빵|케이크|빙수|젤라또)/.test(text)) return "cafe";
        if (/(중식|중국|짜장|짬뽕|마라|탕수|깐풍|양꼬치)/.test(text)) return "chinese";
        if (/(치킨|닭강정|피자|햄버거|버거)/.test(text)) return "chicken";
        if (/(고기|갈비|삼겹|한우|소고기|불고기|곱창|막창|닭갈비|오리|보쌈|족발|구이)/.test(text)) return "meat";
        if (/(분식|떡볶이|라면|라볶이|국수|냉면|막국수|칼국수|만두|수제비|메밀|돈까스|돈가스)/.test(text)) return "noodles";
        if (/(일식|초밥|스시|횟집|회 |우동|돈카츠|파스타|양식|베트남|태국)/.test(text)) return "world";
        if (/(술집|포차|호프|막걸리|이자카야|펍|야식)/.test(text)) return "pub";
        if (/(한식|국밥|해장국|찌개|전골|백반|쌈밥|생선|두부|곰탕|설렁탕|순두부|산채|감자탕)/.test(text)) return "korean";
        return "other";
    }

    function restaurantDataAttributes(item, sectionId) {
        return ' data-venue="' + esc(item.id) + '"' +
            ' data-search="' + esc(restaurantSearchText(item)) + '"' +
            ' data-category="' + restaurantCategory(item) + '"' +
            ' data-status="' + (sectionId === "closed" ? "closed" : "open") + '"' +
            ' data-drive-minutes="' + esc(item.driveMinutes == null ? "" : item.driveMinutes) + '"' +
            ' data-has-hours="' + (item.hours ? "true" : "false") + '"';
    }

    function restaurantRow(item, sectionId) {
        return [
            '<tr' + restaurantDataAttributes(item, sectionId) + '>',
            '<td class="venue-name"><span>' + esc(item.name) + "</span>" + adminActionsHtml(item) + "</td>",
            '<td class="menu-cell">' + tagsHtml(item.menus) + "</td>",
            '<td class="address-cell">' + restaurantAddressHtml(item) + "</td>",
            '<td class="phone-cell">' + phoneLink(item.phone) + "</td>",
            '<td class="score-cell">' + scoreHtml(item) + "</td>",
            '<td class="note-cell">' + textOrDash(item.note) + "</td>",
            '<td class="hours-cell">' + textOrDash(item.hours) + "</td>",
            "</tr>"
        ].join("");
    }

    function restaurantCard(item, sectionId) {
        var meta = "";
        if (item.address || item.driveMinutes) {
            meta += '<p class="venue-address-line"><span aria-hidden="true">📍</span><span>' +
                restaurantAddressHtml(item) + "</span></p>";
        }
        if (item.phone) meta += "<p>☎️ " + phoneLink(item.phone) + "</p>";
        if (item.hours) meta += "<p>🕒 " + esc(item.hours) + "</p>";
        if (item.note) meta += "<p>💬 " + esc(item.note) + "</p>";
        return [
            '<article class="venue-card"' + restaurantDataAttributes(item, sectionId) + '>',
            '<div class="venue-card-heading"><h3>' + esc(item.name) + "</h3>" + adminActionsHtml(item) + "</div>",
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
            section.items.map(function (item) { return restaurantRow(item, section.id); }).join(""),
            "</tbody></table></div>",
            '<div class="mobile-cards">' + section.items.map(function (item) { return restaurantCard(item, section.id); }).join("") + "</div>",
            "</section>"
        ].join("");
    }

    function restaurantFilterState() {
        var input = document.getElementById("venueSearch");
        var category = document.getElementById("venueCategory");
        var status = document.getElementById("venueStatus");
        var distance = document.getElementById("venueDistance");
        var hours = document.getElementById("venueHours");
        return {
            query: input ? input.value.trim().toLocaleLowerCase("ko-KR") : "",
            category: category ? category.value : "all",
            status: status ? status.value : "all",
            distance: distance ? distance.value : "all",
            hoursOnly: Boolean(hours && hours.checked)
        };
    }

    function restaurantMatchesFilters(item, page, state) {
        var status = restaurantSectionId(page, item.id) === "closed" ? "closed" : "open";
        if (state.query && !restaurantSearchText(item).includes(state.query)) return false;
        if (state.category !== "all" && restaurantCategory(item) !== state.category) return false;
        if (state.status !== "all" && status !== state.status) return false;
        if (state.hoursOnly && !item.hours) return false;
        if (state.distance !== "all") {
            var driveMinutes = Number(item.driveMinutes);
            if (!Number.isFinite(driveMinutes) || driveMinutes <= 0 || driveMinutes > Number(state.distance)) return false;
        }
        return true;
    }

    function filteredRestaurantItems() {
        if (!currentRestaurantPage) return [];
        var state = restaurantFilterState();
        return restaurantItems(currentRestaurantPage).filter(function (item) {
            return restaurantMatchesFilters(item, currentRestaurantPage, state);
        });
    }

    function updateRandomRecommendation(items) {
        var candidates = items.filter(function (item) {
            return restaurantSectionId(currentRestaurantPage, item.id) !== "closed";
        });
        var summary = root.querySelector("[data-random-summary]");
        var button = root.querySelector("[data-random-pick]");
        var result = root.querySelector("[data-random-result]");
        if (summary) summary.textContent = candidates.length
            ? "현재 조건의 운영 중 맛집 " + candidates.length + "곳 중에서 골라드려요."
            : "현재 조건에 맞는 운영 중 맛집이 없습니다.";
        if (button) button.disabled = candidates.length === 0;
        if (result && result.dataset.randomVenue && !candidates.some(function (item) {
            return item.id === result.dataset.randomVenue;
        })) {
            result.hidden = true;
            result.removeAttribute("data-random-venue");
        }
        return candidates;
    }

    function applyRestaurantFilters(total) {
        var input = document.getElementById("venueSearch");
        var result = document.getElementById("resultCount");
        var noResults = document.getElementById("searchEmpty");
        if (!input || !result) return;

        var items = filteredRestaurantItems();
        var matchedIds = new Set(items.map(function (item) { return item.id; }));

        root.querySelectorAll("[data-venue]").forEach(function (element) {
            element.hidden = !matchedIds.has(element.dataset.venue);
        });

        root.querySelectorAll("[data-section]").forEach(function (section) {
            var rows = Array.from(section.querySelectorAll("tbody [data-venue]"));
            var count = rows.filter(function (row) { return !row.hidden; }).length;
            section.hidden = count === 0;
            var badge = section.querySelector("[data-section-count]");
            if (badge) badge.textContent = String(count);
        });

        result.innerHTML = "<strong>" + matchedIds.size + "</strong> / " + total + "곳";
        noResults.hidden = matchedIds.size !== 0;
        updateRandomRecommendation(items);
    }

    function resetRestaurantFilters(total) {
        var input = document.getElementById("venueSearch");
        var category = document.getElementById("venueCategory");
        var status = document.getElementById("venueStatus");
        var distance = document.getElementById("venueDistance");
        var hours = document.getElementById("venueHours");
        if (input) input.value = "";
        if (category) category.value = "all";
        if (status) status.value = "all";
        if (distance) distance.value = "all";
        if (hours) hours.checked = false;
        applyRestaurantFilters(total);
    }

    function focusRestaurant(venueId, targetClass) {
        window.setTimeout(function () {
            var targets = Array.from(root.querySelectorAll("[data-venue]")).filter(function (element) {
                return element.dataset.venue === venueId;
            });
            var target = targets.find(function (element) {
                return !element.hidden && element.offsetParent !== null;
            }) || targets[0];
            if (!target) return;
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.classList.add(targetClass);
            window.setTimeout(function () {
                target.classList.remove(targetClass);
            }, 1_600);
        }, 0);
    }

    function pickRandomRestaurant() {
        var candidates = updateRandomRecommendation(filteredRestaurantItems());
        var result = root.querySelector("[data-random-result]");
        if (!candidates.length || !result) return;
        var previousId = result.dataset.randomVenue;
        var pool = candidates.length > 1
            ? candidates.filter(function (item) { return item.id !== previousId; })
            : candidates;
        var randomValue = Math.random();
        if (window.crypto && typeof window.crypto.getRandomValues === "function") {
            var values = new Uint32Array(1);
            window.crypto.getRandomValues(values);
            randomValue = values[0] / 4_294_967_296;
        }
        var item = pool[Math.floor(randomValue * pool.length)];
        var menu = item.menus && item.menus.length ? item.menus.slice(0, 3).join(" · ") : "대표 메뉴 확인 중";
        var drive = item.driveMinutes ? " · 차량 약 " + esc(item.driveMinutes) + "분" : "";
        result.dataset.randomVenue = item.id;
        result.innerHTML = [
            '<div class="random-result-copy"><span>오늘의 한 곳</span><h3>' + esc(item.name) + "</h3>",
            "<p>" + esc(menu) + drive + "</p></div>",
            '<div class="random-result-actions">',
            externalLink(restaurantMapUrl(item), "네이버지도", "action-link"),
            '<button class="action-link" type="button" data-random-focus="' + esc(item.id) + '">목록에서 보기</button>',
            "</div>"
        ].join("");
        result.hidden = false;
        result.focus({ preventScroll: true });
    }

    function bindRestaurantTools(total) {
        var input = document.getElementById("venueSearch");
        var result = document.getElementById("resultCount");
        if (!input || !result) return;

        ["venueSearch", "venueCategory", "venueStatus", "venueDistance", "venueHours"].forEach(function (id) {
            var control = document.getElementById(id);
            if (!control) return;
            control.addEventListener(control === input ? "input" : "change", function () {
                applyRestaurantFilters(total);
            });
        });
        var reset = root.querySelector("[data-filter-reset]");
        if (reset) reset.addEventListener("click", function () { resetRestaurantFilters(total); });
        var random = root.querySelector("[data-random-pick]");
        if (random) random.addEventListener("click", pickRandomRestaurant);
        var randomResult = root.querySelector("[data-random-result]");
        if (randomResult) randomResult.addEventListener("click", function (event) {
            var focus = event.target.closest("[data-random-focus]");
            if (focus) focusRestaurant(focus.dataset.randomFocus, "random-target");
        });
        applyRestaurantFilters(total);
    }

    function bindRankingNavigation() {
        if (rankingControlsBound) return;
        rankingControlsBound = true;
        root.addEventListener("click", function (event) {
            var button = event.target.closest("[data-ranking-venue]");
            if (!button || !root.contains(button)) return;
            var venueId = button.dataset.rankingVenue;
            resetRestaurantFilters(restaurantItems(currentRestaurantPage).length);
            focusRestaurant(venueId, "ranking-target");
        });
    }

    function renderRestaurants(page) {
        currentRestaurantPage = page;
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
            "<p><strong>네이버 지도</strong> 정보를 반영해 이 리조트 주변 운영 중 맛집 " +
                esc(page.naverSource.operatingCount) + "곳을 정리했습니다.</p>",
            "<p>표시된 차량 시간은 " + esc(page.naverSource.routeBasis) +
                "으로, 실제 교통 상황과 경로에 따라 달라질 수 있습니다. " +
                externalLink(page.naverSource.url, "네이버 지도에서 확인", "text-link") + "</p>",
            menuDisclosure,
            data.config && data.config.importedVotingEnabled ? "" :
                "<p>신규 등록 장소의 추천·비추천 평가는 서버 연동을 준비 중입니다.</p>",
            "</aside>"
        ].join("") : "";

        var content = total ? [
            '<section class="restaurant-finder" aria-label="맛집 검색과 필터">',
            '<div class="toolbar"><div class="search-field"><label for="venueSearch">맛집 검색</label>',
            '<input id="venueSearch" type="search" placeholder="이름, 메뉴, 주소로 검색" autocomplete="off"></div>',
            '<div class="result-count" id="resultCount" role="status" aria-live="polite"><strong>' +
                total + "</strong> / " + total + "곳</div></div>",
            '<div class="restaurant-filters">',
            '<label>음식 종류<select id="venueCategory"><option value="all">전체 음식</option><option value="korean">한식</option><option value="meat">고기·구이</option><option value="noodles">면·분식</option><option value="chinese">중식</option><option value="chicken">치킨·피자</option><option value="cafe">카페·디저트</option><option value="world">일식·양식·세계음식</option><option value="pub">술·야식</option><option value="other">기타</option></select></label>',
            '<label>운영 상태<select id="venueStatus"><option value="all">전체 상태</option><option value="open">운영 중</option><option value="closed">폐업</option></select></label>',
            '<label>리조트에서 거리<select id="venueDistance"><option value="all">전체 거리</option><option value="10">차량 10분 이내</option><option value="20">차량 20분 이내</option><option value="30">차량 30분 이내</option></select></label>',
            '<label class="filter-check"><input id="venueHours" type="checkbox"><span>영업시간 정보 있음</span></label>',
            '<button class="filter-reset" type="button" data-filter-reset>필터 초기화</button>',
            "</div></section>",
            '<section class="restaurant-random" aria-labelledby="randomRestaurantTitle">',
            '<div class="random-intro"><span class="eyebrow">RANDOM PICK</span><h2 id="randomRestaurantTitle">오늘 어디서 먹지?</h2>',
            '<p data-random-summary>현재 조건의 운영 중 맛집에서 한 곳을 골라드려요.</p></div>',
            '<button class="random-pick-button" type="button" data-random-pick><span aria-hidden="true">↻</span> 랜덤 추천</button>',
            '<div class="random-result" data-random-result tabindex="-1" aria-live="polite" hidden></div>',
            "</section>",
            sourceDisclosure,
            restaurantRankingsHtml(page),
            page.sections.map(restaurantSection).join(""),
            '<div class="empty-state" id="searchEmpty" hidden>',
            '<span aria-hidden="true">🔎</span><h2>조건에 맞는 맛집이 없습니다</h2><p>검색어나 필터를 바꿔 보세요.</p>',
            "</div>",
            adminModalHtml()
        ].join("") : [
            '<div class="empty-state">',
            '<span aria-hidden="true">🍽️</span>',
            "<h2>등록된 맛집 정보가 아직 없습니다</h2>",
            "<p>원본 데이터에 유효한 항목이 추가되면 이 페이지에도 반영할 수 있습니다.</p>",
            "</div>",
            adminModalHtml()
        ].join("");

        root.innerHTML = '<div class="page-wrap">' + hero(page) + content + footer() + "</div>";
        bindRestaurantTools(total);
        bindRankingNavigation();
        bindAdminControls();
        setAdminUi(adminState.isAdmin);
        if (total) bindVenueVoting(page);
    }

    async function loadMarketCollection(page) {
        if (!voteApiUrl || localPreview) return;
        try {
            var payload = await fetchJson("/collections/marketplace");
            if (Array.isArray(payload.items)) page.items = payload.items;
        } catch (error) {
            console.warn("Marketplace cards unavailable", error && error.message);
        }
    }

    function marketAdminHtml() {
        return [
            '<section class="market-admin-toolbar" data-market-admin data-no-page-edit hidden>',
            '<div><span class="eyebrow">ADMIN</span><strong>거래 카드 관리</strong></div>',
            '<button class="action-link primary" type="button" data-market-add>새 카드 추가</button>',
            '<span class="market-admin-status" data-market-page-status role="status" aria-live="polite">' + esc(marketNotice) + "</span>",
            "</section>"
        ].join("");
    }

    function marketModalHtml() {
        return [
            '<div class="admin-modal" data-market-modal data-no-page-edit hidden>',
            '<section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="marketDialogTitle">',
            '<div class="admin-dialog-head"><div><span class="eyebrow">ADMIN</span>',
            '<h2 id="marketDialogTitle" data-market-dialog-title>거래 카드 추가</h2></div>',
            '<button class="admin-dialog-close" type="button" data-market-close aria-label="거래 카드 편집 창 닫기">×</button></div>',
            '<form data-market-form><input type="hidden" name="itemId">',
            '<div class="admin-form-grid">',
            '<label>거래 상태<select name="status"><option value="팝니다">팝니다</option><option value="삽니다">삽니다</option></select></label>',
            '<label>판매·구매자<input name="member" maxlength="80"></label>',
            '<label class="admin-form-wide">상품명<input name="name" required maxlength="160"></label>',
            '<label class="admin-form-wide">가격·조건<textarea name="price" maxlength="500"></textarea></label>',
            '<label class="admin-form-wide">분류 (쉼표로 구분)<input name="categories" maxlength="480" placeholder="데크, 해머, 티타날"></label>',
            '<label class="admin-form-wide">거래 장소<input name="location" maxlength="300"></label>',
            '<label>톡방 (쉼표로 구분)<input name="chatRooms" maxlength="960"></label>',
            '<label>연락처<input name="phone" maxlength="40" inputmode="tel"></label>',
            '<label class="admin-form-wide">상품 정보 링크<input name="detailUrl" type="url" pattern="https://.*" maxlength="500" placeholder="https://..."></label>',
            '<label class="admin-form-wide">링크 버튼 문구<input name="detailLabel" maxlength="80" placeholder="상품 정보 보기 ↗"></label>',
            "</div>",
            '<div class="admin-form-actions">',
            '<button class="action-link primary" type="submit">저장</button>',
            '<button class="action-link" type="button" data-market-close>취소</button>',
            '<span class="admin-form-status" data-market-status role="status" aria-live="polite"></span>',
            "</div></form></section></div>"
        ].join("");
    }

    function marketCardAdminHtml(item) {
        return [
            '<div class="market-card-admin" data-market-admin data-no-page-edit hidden>',
            '<button type="button" data-market-edit data-item-id="' + esc(item.id) + '">수정</button>',
            '<button class="is-danger" type="button" data-market-delete data-item-id="' + esc(item.id) + '">삭제</button>',
            "</div>"
        ].join("");
    }

    function marketModal() {
        return root.querySelector("[data-market-modal]");
    }

    function setMarketStatus(message, error) {
        root.querySelectorAll("[data-market-status], [data-market-page-status]").forEach(function (status) {
            status.textContent = message || "";
            status.classList.toggle("is-error", Boolean(error));
        });
    }

    function closeMarketModal() {
        var modal = marketModal();
        if (!modal) return;
        modal.hidden = true;
        document.body.removeAttribute("data-admin-modal-open");
    }

    function marketItem(itemId) {
        return currentMarketPage && currentMarketPage.items.find(function (item) {
            return item.id === itemId;
        });
    }

    function openMarketModal(itemId) {
        if (!adminState.isAdmin || !currentMarketPage) return;
        var modal = marketModal();
        if (!modal) return;
        var item = itemId ? marketItem(itemId) : null;
        var form = modal.querySelector("[data-market-form]");
        form.reset();
        form.elements.itemId.value = item ? item.id : "";
        form.elements.status.value = item ? item.status : "팝니다";
        form.elements.name.value = item ? item.name : "";
        form.elements.price.value = item ? item.price : "";
        form.elements.categories.value = item ? (item.categories || []).join(", ") : "";
        form.elements.location.value = item ? item.location : "";
        form.elements.chatRooms.value = item ? (item.chatRooms || []).join(", ") : "";
        form.elements.member.value = item ? item.member : "";
        form.elements.phone.value = item ? item.phone : "";
        form.elements.detailUrl.value = item ? item.detailUrl : "";
        form.elements.detailLabel.value = item ? item.detailLabel : "";
        modal.querySelector("[data-market-dialog-title]").textContent = item ? "거래 카드 수정" : "거래 카드 추가";
        modal.hidden = false;
        document.body.dataset.adminModalOpen = "true";
        setMarketStatus("", false);
        form.elements.name.focus();
    }

    function splitMarketList(value, limit) {
        return String(value || "").split(/\n|,/).map(function (item) {
            return item.trim();
        }).filter(Boolean).slice(0, limit);
    }

    function marketTimestamp() {
        return new Date().toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function newMarketItemId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return "market-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }

    async function persistMarketItems(items, message) {
        var token = getVoteToken();
        if (!token) {
            setAdminUi(false);
            if (window.GoyoungoAuth && typeof window.GoyoungoAuth.reauthenticate === "function") {
                window.GoyoungoAuth.reauthenticate("거래 카드를 관리하려면 카카오 로그인을 다시 해주세요.");
            }
            return false;
        }
        setMarketStatus("저장 중…", false);
        try {
            var payload = await fetchJson("/admin/collections/marketplace", adminRequestOptions({ items: items }));
            currentMarketPage.items = payload.items || [];
            marketNotice = message || "거래 카드 목록을 저장했습니다.";
            closeMarketModal();
            renderMarket(currentMarketPage);
            setAdminUi(true);
            return true;
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                setAdminUi(false);
                if (error.status === 401 && window.GoyoungoAuth && typeof window.GoyoungoAuth.reauthenticate === "function") {
                    window.GoyoungoAuth.reauthenticate("거래 카드를 관리하려면 카카오 로그인을 다시 해주세요.");
                }
            }
            setMarketStatus(error.message || "거래 카드 목록을 저장하지 못했습니다.", true);
            return false;
        }
    }

    async function saveMarketForm(form) {
        var itemId = form.elements.itemId.value || newMarketItemId();
        var detailUrl = form.elements.detailUrl.value.trim();
        var item = {
            id: itemId,
            status: form.elements.status.value,
            name: form.elements.name.value.trim(),
            price: form.elements.price.value.trim(),
            categories: splitMarketList(form.elements.categories.value, 12),
            location: form.elements.location.value.trim(),
            chatRooms: splitMarketList(form.elements.chatRooms.value, 12),
            member: form.elements.member.value.trim(),
            phone: form.elements.phone.value.trim(),
            updatedAt: marketTimestamp(),
            detailUrl: detailUrl,
            detailLabel: detailUrl ? (form.elements.detailLabel.value.trim() || "상품 정보 보기 ↗") : ""
        };
        var existingIndex = currentMarketPage.items.findIndex(function (candidate) {
            return candidate.id === itemId;
        });
        var nextItems = currentMarketPage.items.slice();
        if (existingIndex >= 0) nextItems[existingIndex] = item;
        else nextItems.unshift(item);
        var submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        await persistMarketItems(nextItems, existingIndex >= 0 ? "거래 카드를 수정했습니다." : "새 거래 카드를 추가했습니다.");
        submit.disabled = false;
    }

    async function deleteMarketItem(itemId) {
        var item = marketItem(itemId);
        if (!item || !window.confirm('"' + item.name + '" 카드를 삭제할까요?')) return;
        var nextItems = currentMarketPage.items.filter(function (candidate) {
            return candidate.id !== itemId;
        });
        await persistMarketItems(nextItems, "거래 카드를 삭제했습니다.");
    }

    function bindMarketAdminControls() {
        if (marketAdminBound) return;
        marketAdminBound = true;
        root.addEventListener("click", function (event) {
            var add = event.target.closest("[data-market-add]");
            if (add) return openMarketModal("");
            var edit = event.target.closest("[data-market-edit]");
            if (edit) return openMarketModal(edit.dataset.itemId);
            var remove = event.target.closest("[data-market-delete]");
            if (remove) {
                deleteMarketItem(remove.dataset.itemId);
                return;
            }
            if (event.target.closest("[data-market-close]") || event.target.matches("[data-market-modal]")) {
                closeMarketModal();
            }
        });
        root.addEventListener("submit", function (event) {
            var form = event.target.closest("[data-market-form]");
            if (!form) return;
            event.preventDefault();
            saveMarketForm(form);
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && marketModal() && !marketModal().hidden) closeMarketModal();
        });
    }

    function renderMarket(page) {
        currentMarketPage = page;
        document.title = page.title + " - " + data.brand.title;
        var cards = page.items.map(function (item) {
            return [
                '<article class="content-card" data-market-item-id="' + esc(item.id) + '">',
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
                item.detailUrl ? '<div class="card-actions">' +
                    externalLink(item.detailUrl, item.detailLabel || "상품 정보 보기", "action-link primary") + "</div>" : "",
                '<p class="updated-at">마지막 업데이트 · ' + esc(item.updatedAt) + "</p>",
                marketCardAdminHtml(item),
                "</article>"
            ].join("");
        }).join("");
        if (!cards) {
            cards = [
                '<div class="empty-state market-empty">',
                '<span aria-hidden="true">💵</span>',
                '<h2>등록된 거래 카드가 없습니다</h2>',
                '<p>새 거래 정보가 등록되면 여기에 표시됩니다.</p>',
                "</div>"
            ].join("");
        }
        root.innerHTML = '<div class="page-wrap">' + hero(page) + marketAdminHtml() +
            '<div class="card-grid" data-no-page-edit>' + cards + "</div>" + marketModalHtml() + footer() + "</div>";
        bindMarketAdminControls();
        setAdminUi(adminState.isAdmin);
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
            '<a class="back-link" href="/snowbro/">← 홈으로</a>',
            '<div class="empty-state"><span aria-hidden="true">🏔️</span>',
            "<h1>페이지를 찾을 수 없습니다</h1><p>홈에서 원하는 정보를 다시 선택해 주세요.</p></div>",
            "</div>"
        ].join("");
    }

    async function renderCurrentPage() {
        var pageId = document.body.dataset.page || "home";
        createSiteNavigation(pageId);
        if (pageId === "home") {
            renderHome();
            return;
        }

        var page = data.pages[pageId];
        if (!page) {
            renderUnknown();
        } else if (page.type === "restaurants") {
            root.innerHTML = '<div class="page-wrap narrow"><div class="empty-state"><span aria-hidden="true">🍽️</span><p>맛집 정보를 불러오는 중입니다.</p></div></div>';
            await loadRestaurantOverrides(page);
            renderRestaurants(page);
        } else if (page.type === "market") {
            root.innerHTML = '<div class="page-wrap narrow"><div class="empty-state"><span aria-hidden="true">💵</span><p>거래 카드를 불러오는 중입니다.</p></div></div>';
            await loadMarketCollection(page);
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

    document.addEventListener("goyoungo:authchange", function (event) {
        if (event.detail && event.detail.authenticated) {
            refreshAdminStatus();
        } else {
            setAdminUi(false);
        }
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", renderCurrentPage, { once: true });
    } else {
        renderCurrentPage();
    }
})();
