const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { chromium } = require(process.env.GOYOUNGO_PLAYWRIGHT_ROOT || "playwright");

(async () => {
    const repo = path.resolve(__dirname, "../..");
    const base = process.env.GOYOUNGO_PREVIEW_URL || "http://127.0.0.1:8132";
    const context = { window: {} };
    vm.runInNewContext(await fs.readFile(path.join(repo, "assets/site-data.js"), "utf8"), context);
    const data = context.window.SITE_DATA;
    for (const item of data.navigation) assert.equal(item.title, data.pages[item.id].title);
    assert.equal(data.pages.shuttle.title, "26/27 셔틀 정보");
    data.pages.shuttle.title = "source test";
    assert.equal(data.navigation.find(item => item.id === "shuttle").title, "source test");

    const browser = await chromium.launch({ headless: true, ...(process.env.GOYOUNGO_CHROMIUM_PATH ? { executablePath: process.env.GOYOUNGO_CHROMIUM_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const writes = [];
    let admin = true;
    const records = new Map([
        ["/snowbro/shuttle.html", {
            t_5c235446d538b394: "26/27 스키장 셔틀",
            t_cb1191695903e2f3: "26/27 스키장 셔틀",
            t_d04234efe8da1e81: "26/27 스키장 셔틀"
        }]
    ]);
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname === "ndx4bl2obl.execute-api.ap-northeast-3.amazonaws.com") {
            if (url.pathname === "/admin/me") return route.fulfill({ json: { isAdmin: admin } });
            if (url.pathname === "/page-overrides") {
                const pagePath = url.searchParams.get("pagePath");
                return route.fulfill({ json: { pagePath, fields: records.get(pagePath) || {} } });
            }
            if (url.pathname === "/admin/pages") {
                assert.equal(request.method(), "PUT");
                assert.equal(request.headers().authorization, "Bearer synthetic-test-token");
                const body = request.postDataJSON();
                writes.push(body);
                const fields = { ...(records.get(body.pagePath) || {}) };
                for (const [key, value] of Object.entries(body.fields)) {
                    if (value === null) delete fields[key];
                    else fields[key] = value;
                }
                records.set(body.pagePath, fields);
                return route.fulfill({ json: { pagePath: body.pagePath, fields } });
            }
            if (url.pathname.startsWith("/collections/")) return route.fulfill({ json: { items: null } });
            if (url.pathname === "/restaurant-overrides") return route.fulfill({ json: { overrides: {} } });
            if (url.pathname === "/votes") return route.fulfill({ json: { votes: {} } });
            throw new Error("Unexpected API request: " + request.method() + " " + url.pathname);
        }
        if (url.origin !== base) return route.abort();
        if (url.pathname === "/assets/auth.js") {
            return route.fulfill({ contentType: "text/javascript", body: `window.GoyoungoAuth={getAccessToken:()=>${admin ? '"synthetic-test-token"' : 'null'}};var style=document.createElement("link");style.rel="stylesheet";style.href="/assets/page-editor.css";document.head.appendChild(style);var script=document.createElement("script");script.src="/assets/page-editor.js";document.head.appendChild(script);` });
        }
        return route.continue();
    });

    const sharedTitle = '[data-page-sync-id="snowbro-menu-shuttle-title"]';
    const sharedLink = '[data-page-link-sync-id="snowbro-menu-shuttle-href"]';
    async function open(url) {
        await page.goto(base + url, { waitUntil: "domcontentloaded" });
        await page.locator(sharedTitle + " .page-editable-text").first().waitFor();
        if (admin) await page.locator("[data-page-editor-start]").waitFor({ state: "visible" });
    }
    async function namesEqual(expected) {
        await page.waitForFunction(({ selector, expected }) => {
            const elements = Array.from(document.querySelectorAll(selector));
            return elements.length > 0 && elements.every(element => element.textContent === expected);
        }, { selector: sharedTitle, expected });
    }
    async function save() {
        const pending = page.waitForResponse(response => response.url().endsWith("/admin/pages") && response.request().method() === "PUT");
        await page.locator("[data-page-editor-save]").click();
        await pending;
        await page.locator("[data-page-editor-start]").waitFor({ state: "visible" });
    }

    try {
        await open("/snowbro/season-room.html");
        await namesEqual("26/27 셔틀 정보");
        assert.equal(await page.locator(".page-hero h1").innerText(), "시즌방/주주 구해요");
        await open("/snowbro/shuttle.html");
        await namesEqual("26/27 셔틀 정보");
        assert.equal(await page.locator(sharedTitle).count(), 3);
        assert.match(await page.title(), /^26\/27 셔틀 정보/);
        assert.equal(await page.locator('meta[property="og:title"]').getAttribute("content"), "26/27 셔틀 정보");

        // Editing the H1 must not accidentally save the first (sidebar) copy.
        await page.locator("[data-page-editor-start]").click();
        await page.locator(".page-hero h1 .page-editable-text").fill("공통 셔틀 이름 테스트");
        await namesEqual("공통 셔틀 이름 테스트");
        await save();
        assert.equal(writes.at(-1).pagePath, "/snowbro/");
        assert.equal(Object.keys(writes.at(-1).fields).length, 1);
        assert.equal(Object.values(writes.at(-1).fields)[0], "공통 셔틀 이름 테스트");

        await open("/snowbro/");
        await namesEqual("공통 셔틀 이름 테스트");
        assert.equal(await page.locator(sharedTitle).count(), 2);
        await page.locator("[data-page-editor-start]").click();
        await page.locator(".hub-card " + sharedTitle + " .page-editable-text").fill("취소할 임시 이름");
        await namesEqual("취소할 임시 이름");
        await page.locator("[data-page-editor-cancel]").click();
        await namesEqual("공통 셔틀 이름 테스트");

        await page.locator("[data-page-editor-start]").click();
        await page.locator(".hub-card" + sharedLink).click();
        await page.locator("#pageEditorLinkInput").fill("/snowbro/shuttle.html?shared=1");
        const hrefs = await page.locator(sharedLink).evaluateAll(links => links.map(link => link.getAttribute("href")));
        assert.ok(hrefs.length === 2 && hrefs.every(href => href === "/snowbro/shuttle.html?shared=1"));
        await save();
        assert.equal(writes.at(-1).pagePath, "/snowbro/");
        assert.ok(Object.keys(writes.at(-1).fields)[0].startsWith("l_"));

        await open("/snowbro/season-room.html");
        await namesEqual("공통 셔틀 이름 테스트");
        assert.equal(await page.locator(sharedLink).getAttribute("href"), "/snowbro/shuttle.html?shared=1");
        assert.equal(await page.locator(sharedLink + " > span").first().innerText(), "🚌");

        // Unrelated page text remains page-specific, and blog sync stays intact.
        await page.locator("[data-page-editor-start]").click();
        await page.locator(".source-footer strong .page-editable-text").fill("이 페이지만 수정");
        await save();
        assert.equal(writes.at(-1).pagePath, "/snowbro/season-room.html");
        await open("/snowbro/shuttle.html");
        assert.equal(await page.locator(".source-footer strong").innerText(), "GO.YOUNGO");

        await page.goto(base + "/blog/goyoungo-building-story.html");
        await page.locator("[data-page-editor-start]").waitFor({ state: "visible" });
        await page.locator("[data-page-editor-start]").click();
        await page.locator('[data-page-sync-id="blog-post-01-title"] .page-editable-text').fill("블로그 동기화 회귀 테스트");
        await save();
        assert.equal(writes.at(-1).pagePath, "/blog/goyoungo-building-story.html");
        await page.goto(base + "/blog/");
        await page.waitForFunction(() => document.querySelector('[data-page-sync-id="blog-post-01-title"]').textContent === "블로그 동기화 회귀 테스트");

        admin = false;
        await page.setViewportSize({ width: 390, height: 844 });
        await open("/snowbro/shuttle.html");
        await namesEqual("공통 셔틀 이름 테스트");
        assert.match(await page.title(), /^공통 셔틀 이름 테스트/);
        assert.equal(await page.locator("#pageEditorToolbar").isVisible(), false);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ result: "SHARED_MENU_OK", sourceTitles: data.navigation.length, titleAndLinkPersistence: true, cancelAndLocalEdits: true, blogSync: true, anonymousMobile: 390, consoleErrors: 0 }));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
