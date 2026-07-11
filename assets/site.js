(function () {
    "use strict";

    var data = window.SITE_DATA;
    var root = document.getElementById("pageRoot");
    if (!data || !root) return;

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
            '<p class="eyebrow">GO.YOUNGO COMMUNITY</p>',
            "<h1>" + esc(page.title) + "</h1>",
            "<p>" + esc(page.subtitle || "") + "</p>",
            '<p class="snapshot-note">Notion 원본에서 복사한 읽기 전용 데이터 · ' + esc(data.brand.snapshotDate) + "</p>",
            "</header>"
        ].join("");
    }

    function footer() {
        return [
            '<footer class="source-footer">',
            "이 페이지는 외부 Notion 화면을 연결하지 않고, 원본 데이터를 자체 홈페이지 형식으로 재구성했습니다. ",
            "운영 정보는 달라질 수 있으니 방문 전 업체에 확인해 주세요.",
            "</footer>"
        ].join("");
    }

    function renderHome() {
        document.title = data.brand.title + " - " + data.brand.byline;
        var cards = data.navigation.map(function (item) {
            return [
                '<a class="hub-card" href="' + esc(item.href) + '">',
                '<span class="hub-card-icon" aria-hidden="true">' + esc(item.icon) + "</span>",
                "<span><strong>" + esc(item.title) + "</strong><small>" + esc(item.summary) + "</small></span>",
                '<span class="hub-arrow" aria-hidden="true">→</span>',
                "</a>"
            ].join("");
        }).join("");

        root.innerHTML = [
            '<div class="page-wrap">',
            '<header class="home-hero">',
            '<p class="home-kicker">GO.YOUNGO COMMUNITY</p>',
            "<h1>" + esc(data.brand.title) + "<br>" + esc(data.brand.byline) + "</h1>",
            "<p>맛집, 장비 거래, 시즌방, 제휴 혜택과 셔틀 정보를 한곳에서 확인하세요. 모든 항목은 goyoungo.com 내부 자체 페이지로 열립니다.</p>",
            "</header>",
            '<nav class="hub-grid" aria-label="스키장 정보 페이지">' + cards + "</nav>",
            '<section class="comments-section" aria-labelledby="commentsTitle">',
            '<h2 class="section-heading" id="commentsTitle">업데이트 요청</h2>',
            '<iframe class="comments-frame" src="https://apption.co/app_posts/667c8ee7" title="업데이트 요청 댓글" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>',
            "</section>",
            footer(),
            "</div>"
        ].join("");
    }

    function scoreHtml(item) {
        var scoreClass = item.score > 0 ? "positive" : item.score < 0 ? "negative" : "";
        var prefix = item.score > 0 ? "+" : "";
        return '<span class="score ' + scoreClass + '">' + prefix + esc(item.score) + "</span>" +
            '<span class="score-detail">추천 ' + item.recommenders.length + " · 비추천 " + item.detractors.length + "</span>";
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

    function restaurantRow(item) {
        return [
            '<tr data-venue="' + esc(item.id) + '" data-search="' + esc(restaurantSearchText(item)) + '">',
            '<td class="venue-name">' + esc(item.name) + "</td>",
            '<td class="menu-cell">' + tagsHtml(item.menus) + "</td>",
            '<td class="address-cell">' + textOrDash(item.address) + "</td>",
            '<td class="phone-cell">' + phoneLink(item.phone) + "</td>",
            '<td class="score-cell">' + scoreHtml(item) + "</td>",
            '<td class="note-cell">' + textOrDash(item.note) + "</td>",
            '<td class="hours-cell">' + textOrDash(item.hours) + "</td>",
            "</tr>"
        ].join("");
    }

    function restaurantCard(item) {
        var meta = "";
        if (item.address) meta += "<p>📍 " + esc(item.address) + "</p>";
        if (item.phone) meta += "<p>☎️ " + phoneLink(item.phone) + "</p>";
        if (item.hours) meta += "<p>🕒 " + esc(item.hours) + "</p>";
        if (item.note) meta += "<p>💬 " + esc(item.note) + "</p>";
        return [
            '<article class="venue-card" data-venue="' + esc(item.id) + '" data-search="' + esc(restaurantSearchText(item)) + '">',
            "<h3>" + esc(item.name) + "</h3>",
            tagsHtml(item.menus),
            '<div class="venue-meta">' + meta + "</div>",
            '<div class="venue-score"><span>' + scoreHtml(item) + "</span></div>",
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

    function renderRestaurants(page) {
        var total = page.sections.reduce(function (sum, section) {
            return sum + section.items.length;
        }, 0);
        document.title = page.title + " - " + data.brand.title;

        var content = total ? [
            '<div class="toolbar">',
            '<div class="search-field"><label for="venueSearch">맛집 검색</label>',
            '<input id="venueSearch" type="search" placeholder="이름, 메뉴, 주소로 검색" autocomplete="off"></div>',
            '<div class="result-count" id="resultCount" role="status" aria-live="polite"><strong>' +
                total + "</strong> / " + total + "곳</div>",
            "</div>",
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

