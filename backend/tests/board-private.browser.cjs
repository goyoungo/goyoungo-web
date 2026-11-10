const assert = require("node:assert/strict");
const { chromium } = require(process.env.GOYOUNGO_PLAYWRIGHT_ROOT || "playwright");
const { lambdaHarness } = require("./voting-runtime.cjs");

(async () => {
    const base = process.env.GOYOUNGO_PREVIEW_URL || "http://127.0.0.1:8132";
    const browser = await chromium.launch({ headless: true, ...(process.env.GOYOUNGO_CHROMIUM_PATH ? { executablePath: process.env.GOYOUNGO_CHROMIUM_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let role = "guest";
    let failTool = false;
    let delayTool = false;
    let releaseTool;
    const requests = [];
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const tokenFor = value => value === "guest" ? null : "synthetic-" + value + "-token-1234567890";
    await page.route("**/*", async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname === "ndx4bl2obl.execute-api.ap-northeast-3.amazonaws.com") {
            requests.push({ path: url.pathname, query: url.searchParams.get("pagePath"), auth: request.headers().authorization });
            if (url.pathname === "/admin/tools/board-size" && failTool) return route.fulfill({ status: 503, json: { message: "test outage" } });
            const requestRole = role;
            const runtime = lambdaHarness(requestRole === "admin" ? "1" : "2");
            if (url.pathname === "/admin/tools/board-size" && delayTool) {
                delayTool = false;
                await new Promise(resolve => { releaseTool = resolve; });
            }
            const result = await runtime.api.handler({
                rawPath: url.pathname,
                requestContext: { http: { method: request.method() } },
                headers: request.headers(),
                queryStringParameters: Object.fromEntries(url.searchParams)
            });
            return route.fulfill({ status: result.statusCode, headers: result.headers, body: result.body });
        }
        if (url.origin !== base) return route.abort();
        if (url.pathname === "/assets/auth.js") {
            return route.fulfill({ contentType: "text/javascript", body: `window.__testToken=${JSON.stringify(tokenFor(role))};window.GoyoungoAuth={getAccessToken:()=>window.__testToken};var style=document.createElement("link");style.rel="stylesheet";style.href="/assets/page-editor.css";document.head.appendChild(style);var script=document.createElement("script");script.src="/assets/page-editor.js";document.head.appendChild(script);setTimeout(()=>document.dispatchEvent(new CustomEvent("goyoungo:authchange",{detail:{authenticated:!!window.__testToken}})),50);` });
        }
        return route.continue();
    });
    async function open(path) {
        await page.goto(base + path, { waitUntil: "domcontentloaded" });
        await page.locator(".page-root h1").waitFor();
    }
    async function auth(value) {
        role = value;
        await page.evaluate(token => {
            window.__testToken = token;
            document.dispatchEvent(new CustomEvent("goyoungo:authchange", { detail: { authenticated: !!token } }));
        }, tokenFor(value));
    }
    async function locked() {
        await page.waitForFunction(() => document.querySelector(".page-root h1")?.textContent === "관리자 전용 페이지");
        assert.equal(await page.locator("#boardSizeForm").count(), 0);
        assert.equal(await page.evaluate(() => typeof window.GoyoungoAdminBoardSize), "undefined");
    }
    try {
        await open("/snowbro/");
        assert.equal(await page.locator('[data-menu-id="board-size"]').count(), 0);
        const memberCheck = page.waitForResponse(response => response.url().endsWith("/admin/me"));
        await auth("member");
        await memberCheck;
        assert.equal(await page.locator('[data-menu-id="board-size"]').count(), 0);
        await auth("admin");
        await page.locator('.utility-grid .hub-card[data-menu-id="board-size"]').waitFor();
        assert.equal(await page.locator('[data-menu-id="board-size"]').count(), 2);
        await auth("guest");
        assert.equal(await page.locator('[data-menu-id="board-size"]').count(), 0);

        await open("/snowbro/board-size.html");
        await locked();
        assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /noindex/);
        assert.equal(requests.filter(request => request.path === "/admin/tools/board-size").length, 0);

        await auth("member");
        await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes("관리자 권한이 없거나"));
        await locked();
        const privateOverride = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === "/page-overrides" && url.searchParams.get("pagePath") === "/snowbro/board-size.html";
        });
        await auth("admin");
        await page.locator("#boardSizeForm").waitFor();
        assert.equal(await page.locator("#boardSizeRecommended").innerText(), "160");
        await page.locator('input[name="style"][value="전향 해머 트릭"]').check();
        assert.equal(await page.locator("#boardSizeRecommended").innerText(), "154");
        await page.locator('input[name="style"][value="덕 라이딩"]').check();
        assert.equal(await page.locator("#boardSizeRecommended").innerText(), "154");
        await page.locator('input[name="style"][value="알파인"]').check();
        assert.deepEqual(await page.locator(".board-size-dual-value strong").allTextContents(), ["156", "177"]);
        await page.locator('input[name="weight"]').fill("80");
        assert.deepEqual(await page.locator(".board-size-dual-value strong").allTextContents(), ["162", "186"]);
        await page.waitForFunction(() => document.body.hasAttribute("data-page-admin"));
        await privateOverride;
        assert.ok(requests.some(request => request.query === "/snowbro/board-size.html" && request.auth === "Bearer " + tokenFor("admin")));
        await auth("guest");
        await locked();
        assert.equal(await page.locator('[data-menu-id="board-size"]').count(), 0);

        // A response authorized before logout must not reopen the calculator.
        delayTool = true;
        await auth("admin");
        await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes("확인하고"));
        while (!releaseTool) await new Promise(resolve => setTimeout(resolve, 5));
        await auth("guest");
        const received = page.waitForResponse(response => response.url().endsWith("/admin/tools/board-size"));
        releaseTool();
        await received;
        await locked();

        failTool = true;
        await auth("admin");
        await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes("확인하지 못했습니다"));
        await locked();
        failTool = false;
        await page.locator("#privateBoardLogin").click();
        await page.locator("#boardSizeForm").waitFor();
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
        await locked();
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
        await page.locator("#boardSizeForm").waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => getComputedStyle(document.querySelector(".page-root")).marginLeft === "0px");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ result: "PRIVATE_BOARD_OK", guestAndMemberDenied: true, adminCalculator: true, logoutAndStaleResponse: true, failClosedAndHistory: true, mobile: 390, consoleErrors: 0 }));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
