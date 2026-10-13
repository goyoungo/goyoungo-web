const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.GOYOUNGO_PLAYWRIGHT_ROOT || "playwright");

(async () => {
    const base = "http://127.0.0.1:8132";
    const repo = path.resolve(__dirname, "../..");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const fixturePhoto = "11111111-1111-4111-8111-111111111111.jpg";
    let items = [
        { id: "completed", type: "주주 구해요", status: "완료", name: "완료된 시즌방", updatedAt: "2026년 10월 13일 19:00", resort: "웰리힐리파크", season: "26/27", stayTypes: ["주말"], budgetManwon: 70 },
        { id: "older-card", type: "시즌방 구해요", status: "진행중", name: "휘팍 시즌방 찾습니다", updatedAt: "2026년 10월 10일 10:00", resort: "휘닉스 평창", season: "25/26", stayTypes: ["주중"], budgetManwon: 50 },
        { id: "newer-card", type: "주주 구해요", status: "진행중", name: "웰팍 주말 주주 모집", updatedAt: "2026년 10월 12일 10:00", resort: "웰리힐리파크", season: "26/27", stayTypes: ["주말"], budgetManwon: 80, photos: [fixturePhoto] }
    ].map(item => ({ contact: "", sns: "", gender: [], details: "주방과 장비 보관 공간이 있어요.\n주말 이용 가능합니다.", price: "80만원", links: [], ...item }));
    let uploads = 0;
    let png;
    let lastSaved;
    const fixturePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
    await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname === "/assets/site-data.js") {
            const source = await fs.readFile(path.join(repo, "assets/site-data.js"), "utf8");
            return route.fulfill({ contentType: "text/javascript", body: source + "\nwindow.SITE_DATA.config.voteApiUrl=" + JSON.stringify(base + "/qa-api") + ";" });
        }
        if (url.pathname === "/assets/auth.js") {
            return route.fulfill({ contentType: "text/javascript", body: 'window.GoyoungoAuth={getAccessToken:()=>"synthetic-test-token"};document.addEventListener("DOMContentLoaded",()=>setTimeout(()=>document.dispatchEvent(new CustomEvent("goyoungo:authchange",{detail:{authenticated:true}})),100));' });
        }
        if (url.pathname.startsWith("/qa-api/season-photos/")) return route.fulfill({ contentType: "image/png", body: png || fixturePng });
        if (url.pathname === "/qa-api/admin/me") return route.fulfill({ json: { isAdmin: true } });
        if (url.pathname === "/qa-api/collections/season-room") return route.fulfill({ json: { items } });
        if (url.pathname === "/qa-api/admin/season-photos") {
            const body = route.request().postDataJSON();
            assert.equal(body.contentType, "image/jpeg");
            assert.ok(Buffer.from(body.data, "base64").length <= 600 * 1024);
            assert.equal(route.request().headers().authorization, "Bearer synthetic-test-token");
            uploads++;
            return route.fulfill({ status: 201, json: { photoId: "22222222-2222-4222-8222-" + String(uploads).padStart(12, "0") + ".jpg" } });
        }
        if (url.pathname === "/qa-api/admin/collections/season-room") {
            lastSaved = route.request().postDataJSON();
            items = lastSaved.items;
            return route.fulfill({ json: { items } });
        }
        return route.continue();
    });
    try {
        await page.goto(base + "/snowbro/season-room.html");
        await page.locator('[data-collection-add]').waitFor({ state: "visible" });
        const cards = page.locator('[data-season-grid] [data-collection-item-id]');
        assert.deepEqual(await cards.evaluateAll(elements => elements.map(element => element.dataset.collectionItemId)), ["newer-card", "older-card", "completed"]);
        await page.locator('[data-season-filters] [name="type"]').selectOption("주주 구해요");
        assert.equal(await cards.count(), 2);
        await page.locator('[data-season-filters] [name="status"]').selectOption("진행중");
        await page.locator('[data-season-filters] [name="resort"]').selectOption("웰리힐리파크");
        await page.locator('[data-season-filters] [name="season"]').selectOption("26/27");
        await page.locator('[data-season-filters] [name="stay"]').selectOption("주말");
        await page.locator('[data-season-filters] [name="budget"]').fill("90");
        assert.equal(await cards.count(), 1);
        assert.ok(await cards.first().getByRole("button", { name: "수정", exact: true }).isVisible());
        await page.locator('[data-season-reset]').click();
        assert.equal(await cards.count(), 3);
        const pngData = await page.evaluate(() => {
            const canvas = document.createElement("canvas");
            canvas.width = 100; canvas.height = 80;
            const context = canvas.getContext("2d");
            context.fillStyle = "#f05a28"; context.fillRect(0, 0, 100, 80);
            return canvas.toDataURL("image/png").split(",")[1];
        });
        png = Buffer.from(pngData, "base64");
        await page.locator('[data-collection-add]').click();
        const form = page.locator('[data-collection-form]');
        await form.locator('[name="name"]').fill("테스트 시즌방");
        await form.locator('[name="resort"]').selectOption("웰리힐리파크");
        await form.locator('[name="season"]').fill("26/27");
        await form.locator('[name="budgetManwon"]').fill("85");
        await form.locator('[name="stayType"][value="주말"]').check();
        await form.locator('[name="details"]').fill("첫째 줄\n둘째 줄");
        await form.locator('[data-season-photo-input]').setInputFiles({ name: "selected.png", mimeType: "image/png", buffer: png });
        await page.waitForFunction(() => document.querySelectorAll('[data-season-photo-previews] img').length === 1);
        await form.locator('[data-season-drop]').evaluate((element, base64) => {
            const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
            const transfer = new DataTransfer();
            transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
            element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        }, pngData);
        await page.waitForFunction(() => document.querySelectorAll('[data-season-photo-previews] img').length === 2);
        await form.locator('[name="details"]').evaluate((element, base64) => {
            const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
            const transfer = new DataTransfer();
            transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
            element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
        }, pngData);
        await page.waitForFunction(() => document.querySelectorAll('[data-season-photo-previews] img').length === 3);
        assert.equal(uploads, 0, "저장 전에는 서버로 사진을 보내지 않음");
        const textPastePrevented = await form.locator('[name="details"]').evaluate(element => {
            const transfer = new DataTransfer();
            transfer.setData("text/plain", "일반 텍스트");
            const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
            element.dispatchEvent(event);
            return event.defaultPrevented;
        });
        assert.equal(textPastePrevented, false);
        await form.getByRole("button", { name: "저장", exact: true }).click();
        await page.locator('[data-collection-modal]').waitFor({ state: "hidden" });
        assert.equal(uploads, 3);
        const saved = lastSaved.items.find(item => item.name === "테스트 시즌방");
        assert.equal(saved.photos.length, 3);
        assert.equal(saved.details, "첫째 줄\n둘째 줄");
        assert.equal(saved.budgetManwon, 85);
        const newCard = page.locator('[data-collection-item-id="' + saved.id + '"]');
        await newCard.getByRole("button", { name: "수정", exact: true }).click();
        assert.equal(await form.locator('[data-season-photo-previews] img').count(), 3);
        await form.locator('[data-season-photo-remove="1"]').click();
        await form.getByRole("button", { name: "저장", exact: true }).click();
        await page.locator('[data-collection-modal]').waitFor({ state: "hidden" });
        assert.equal(uploads, 3, "수정할 때 기존 사진을 다시 업로드하지 않음");
        assert.equal(lastSaved.items.find(item => item.id === saved.id).photos.length, 2);
        await page.locator('[data-season-gallery="' + saved.id + '"]').click();
        assert.equal(await page.locator('.season-gallery-nav span').innerText(), "1 / 2");
        await page.locator('[data-gallery-next]').click();
        assert.equal(await page.locator('.season-gallery-nav span').innerText(), "2 / 2");
        await page.locator('[data-gallery-close]').click();
        await page.evaluate(() => document.documentElement.dataset.theme = "dark");
        await fs.mkdir(path.join(repo, ".qa-artifacts"), { recursive: true });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(repo, ".qa-artifacts/season-desktop.png"), animations: "disabled" });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.page-root')).marginLeft === "0px" && document.querySelector('.site-sidebar').getBoundingClientRect().right <= 0);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(repo, ".qa-artifacts/season-mobile.png"), animations: "disabled" });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "모바일 가로 넘침 없음");
        assert.deepEqual(errors, []);
        console.log("PASS: 필터 조합, 완료글 정렬, 관리자 수정, 파일 선택·드롭·붙여넣기, 사진 저장·삭제·재사용·갤러리, 모바일 가로폭, 콘솔 오류");
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
