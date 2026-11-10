const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { lambdaHarness } = require("./voting-runtime.cjs");

function event(rawPath, token = "t".repeat(30), queryStringParameters) {
    return { rawPath, requestContext: { http: { method: "GET" } }, headers: token ? { authorization: "Bearer " + token } : {}, queryStringParameters };
}

test("비로그인·위조 형식·일반 회원·만료 토큰은 계산기 코드를 받지 못함", async () => {
    const cases = [
        [lambdaHarness(), "", 401],
        [lambdaHarness(), "short", 401],
        [lambdaHarness("2"), "t".repeat(30), 403],
        [lambdaHarness("1", { expiresIn: 0 }), "t".repeat(30), 401]
    ];
    for (const [runtime, token, status] of cases) {
        const response = await runtime.api.handler(event("/admin/tools/board-size", token));
        assert.equal(response.statusCode, status);
        assert.equal(JSON.parse(response.body).script, undefined);
        assert.ok(!response.body.includes("boardSizeForm"));
    }
});

test("검증된 관리자에게만 기존 계산기를 반환하고 캐시·색인 금지", async () => {
    const response = await lambdaHarness().api.handler(event("/admin/tools/board-size"));
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.match(response.headers["x-robots-tag"], /noindex/);
    const { script } = JSON.parse(response.body);
    assert.match(script, /boardSizeForm/);
    assert.match(script, /전향 해머 트릭/);
    assert.match(script, /덕 라이딩/);
    const sandbox = { window: {} };
    vm.runInNewContext(script, sandbox);
    assert.equal(typeof sandbox.window.GoyoungoAdminBoardSize, "function");
});

test("비공개 페이지 수정값도 관리자만 조회, 공개 페이지는 영향 없음", async () => {
    const privateQuery = { pagePath: "/snowbro/board-size.html" };
    const path = "/page-overrides";
    assert.equal((await lambdaHarness().api.handler(event(path, "", privateQuery))).statusCode, 401);
    assert.equal((await lambdaHarness("2").api.handler(event(path, "t".repeat(30), privateQuery))).statusCode, 403);
    assert.equal((await lambdaHarness().api.handler(event(path, "t".repeat(30), privateQuery))).statusCode, 200);
    assert.equal((await lambdaHarness().api.handler(event(path, "", { pagePath: "/snowbro/shuttle.html" }))).statusCode, 200);
});

test("공개 배포에는 서버·테스트·문서를 포함하지 않고 계산기 본문도 없음", () => {
    const root = path.resolve(__dirname, "../..");
    execFileSync(process.execPath, ["scripts/build-static.mjs"], { cwd: root });
    const output = path.join(root, "dist");
    for (const name of ["backend", "scripts", "docs", ".git", ".omc", ".qa-artifacts", ".qa-browsers", "README.md", "KAKAO_SETUP.md"]) {
        assert.equal(fs.existsSync(path.join(output, name)), false, name);
    }
    for (const file of ["index.html", "ads.txt", "robots.txt", "sitemap.xml", "assets/site.js", "snowbro/board-size.html", "runbro/index.html", "blog/index.html"]) {
        assert.equal(fs.existsSync(path.join(output, file)), true, file);
    }
    const publicScript = fs.readFileSync(path.join(output, "assets/site.js"), "utf8");
    assert.ok(!publicScript.includes("boardSizeForm"));
    assert.ok(!publicScript.includes("styleRules"));
    assert.ok(!fs.readFileSync(path.join(output, "sitemap.xml"), "utf8").includes("board-size"));
    assert.match(fs.readFileSync(path.join(output, "snowbro/board-size.html"), "utf8"), /noindex, nofollow, noarchive/);
});
