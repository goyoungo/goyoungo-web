const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const board = require("../../assets/season-board.js");

test("완료 글은 항상 뒤쪽, 같은 상태 안에서는 최근 수정순", () => {
    const items = [
        { id: "done", status: "완료", updatedAt: "2026-10-13T15:00:00Z" },
        { id: "old", status: "진행중", updatedAt: "2024년 10월 25일 15:28" },
        { id: "new", status: "진행중", updatedAt: "2026년 10월 13일 15:28" }
    ];
    assert.deepEqual(board.filteredItems(items, {}).map(item => item.id), ["new", "old", "done"]);
    assert.deepEqual(items.map(item => item.id), ["done", "old", "new"]);
});

test("필터 조합과 미입력 예산 처리", () => {
    const items = [
        { id: "match", type: "주주 구해요", status: "진행중", resort: "웰리힐리파크", season: "26/27", stayTypes: ["주말"], budgetManwon: 80 },
        { id: "expensive", type: "주주 구해요", status: "진행중", resort: "웰리힐리파크", season: "26/27", stayTypes: ["주말"], budgetManwon: 100 },
        { id: "unknown", type: "주주 구해요", status: "진행중", resort: "웰리힐리파크", season: "26/27", stayTypes: ["주말"] },
        { id: "other", type: "시즌방 구해요", status: "완료", resort: "휘닉스 평창", season: "25/26", stayTypes: ["주중"], budgetManwon: 50 }
    ];
    assert.equal(board.filteredItems(items, {}).length, 4);
    assert.deepEqual(board.filteredItems(items, { type: "주주 구해요", resort: "웰리힐리파크", season: "26/27", stay: "주말", budget: "80", status: "진행중" }).map(item => item.id), ["match"]);
    assert.deepEqual(board.filteredItems(items, { status: "완료" }).map(item => item.id), ["other"]);
    assert.equal(board.timestamp("2026년 10월 13일 15:28"), Date.parse("2026-10-13T15:28:00+09:00"));
    assert.equal(board.timestamp("2026년 10월 13일 오후 03:28"), Date.parse("2026-10-13T15:28:00+09:00"));
    assert.equal(board.timestamp("2026년 10월 13일 오전 12:28"), Date.parse("2026-10-13T00:28:00+09:00"));
    assert.equal(board.timestamp("2026년 10월 13일 오후 12:28"), Date.parse("2026-10-13T12:28:00+09:00"));
});

function sourceLambdaCode() {
    const template = fs.readFileSync(path.join(__dirname, "../voting-stack.yaml"), "utf8");
    return template.split(/ZipFile: \|\r?\n/)[1].split(/\r?\n  VoteApi:/)[0].split(/\r?\n/).map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");
}

test("배포된 Lambda는 로컬 UTF-8 소스와 동일", { skip: !process.env.GOYOUNGO_VOTING_CODE }, () => {
    const hash = code => require("node:crypto").createHash("sha256").update(code.replace(/\r\n/g, "\n").trim()).digest("hex");
    assert.equal(hash(fs.readFileSync(process.env.GOYOUNGO_VOTING_CODE, "utf8")), hash(sourceLambdaCode()));
});

function lambdaHarness(userId = "1") {
    const code = process.env.GOYOUNGO_VOTING_CODE
        ? fs.readFileSync(process.env.GOYOUNGO_VOTING_CODE, "utf8")
        : sourceLambdaCode();
    const objects = new Map();
    const records = new Map();
    class PutObjectCommand { constructor(input) { this.input = input; } }
    class GetObjectCommand { constructor(input) { this.input = input; } }
    class Command { constructor(input) { this.input = input; } }
    class GetCommand extends Command {}
    class TransactWriteCommand extends Command {}
    class S3Client {
        async send(command) {
            if (command instanceof PutObjectCommand) { objects.set(command.input.Key, command.input); return {}; }
            const object = objects.get(command.input.Key);
            if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
            return { ContentLength: object.Body.length, Body: { transformToByteArray: async () => object.Body } };
        }
    }
    const sandbox = {
        exports: {}, Buffer, URL, Set, console, AbortSignal,
        process: { env: { VOTE_TABLE_NAME: "test-table", SEASON_PHOTO_BUCKET: "test-bucket", KAKAO_APP_ID: "1470643", VOTE_HMAC_SECRET: "x".repeat(32), ADMIN_KAKAO_USER_IDS: "1" } },
        fetch: async () => ({ ok: true, text: async () => JSON.stringify({ id: +userId, app_id: 1470643, expires_in: 3600 }) }),
        require: name => {
            if (name === "node:crypto") return require(name);
            if (name === "@aws-sdk/client-s3") return { S3Client, PutObjectCommand, GetObjectCommand };
            if (name === "@aws-sdk/client-dynamodb") return { DynamoDBClient: Command };
            if (name === "@aws-sdk/lib-dynamodb") return {
                DynamoDBDocumentClient: { from: () => ({ send: async command => {
                    if (command instanceof GetCommand) return { Item: records.get(command.input.Key.pk + "|" + command.input.Key.sk) };
                    if (command instanceof TransactWriteCommand) {
                        for (const operation of command.input.TransactItems) {
                            const item = operation.Put.Item;
                            records.set(item.pk + "|" + item.sk, item);
                        }
                    }
                    return {};
                } }) },
                BatchGetCommand: Command, GetCommand, QueryCommand: Command, TransactWriteCommand
            };
            throw new Error("Unexpected import " + name);
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(code + "\nexports.validateSeasonItems = validateSeasonItems;", sandbox);
    return { api: sandbox.exports, objects };
}

function uploadEvent(body, token = "t".repeat(30)) {
    return { requestContext: { http: { method: "POST" } }, rawPath: "/admin/season-photos", headers: token ? { authorization: "Bearer " + token } : {}, body: JSON.stringify(body) };
}

test("기존 모집글은 그대로 읽고 새 필터·사진 항목만 검증", () => {
    const { api } = lambdaHarness();
    const old = { id: "old-card", type: "주주 구해요", status: "완료", name: "기존 모집글", details: "기존 내용\n둘째 줄", gender: [], links: [] };
    const normalized = api.validateSeasonItems([old])[0];
    assert.equal(normalized.details, old.details);
    assert.equal(normalized.budgetManwon, null);
    assert.equal(normalized.photos.length, 0);
    assert.throws(() => api.validateSeasonItems([{ ...old, season: "26/29" }]), /연도/);
    assert.throws(() => api.validateSeasonItems([{ ...old, photos: ["../../secret"] }]), /식별자/);
    assert.throws(() => api.validateSeasonItems([{ ...old, budgetManwon: -1 }]), /비용/);
    assert.throws(() => api.validateSeasonItems([{ ...old, photos: Array(7).fill("x") }]), /항목 수/);
});

test("관리자 업로드와 공개 사진 읽기, 비관리자 거부", async () => {
    const { api, objects } = lambdaHarness();
    const data = Buffer.from([255, 216, 255, 224, 255, 217]).toString("base64");
    const uploaded = await api.handler(uploadEvent({ contentType: "image/jpeg", data }));
    assert.equal(uploaded.statusCode, 201);
    const photoId = JSON.parse(uploaded.body).photoId;
    const object = objects.get("season-photos/" + photoId);
    assert.equal(object.ServerSideEncryption, "AES256");
    const fetched = await api.handler({ requestContext: { http: { method: "GET" } }, rawPath: "/season-photos/" + photoId, pathParameters: { photoId } });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.isBase64Encoded, true);
    assert.equal(fetched.headers["content-type"], "image/jpeg");
    assert.equal(fetched.body, data);
    const nonAdmin = await lambdaHarness("2").api.handler(uploadEvent({ contentType: "image/jpeg", data }));
    assert.equal(nonAdmin.statusCode, 403);
    const unauthenticated = await api.handler(uploadEvent({ contentType: "image/jpeg", data }, ""));
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(JSON.parse(unauthenticated.body).message, "카카오 로그인이 필요합니다.");
});

test("한글 유형·필터를 포함한 사진 첨부 글을 저장하고 다시 조회", async () => {
    const { api } = lambdaHarness();
    const uploaded = await api.handler(uploadEvent({ contentType: "image/jpeg", data: Buffer.from([255, 216, 255, 224, 255, 217]).toString("base64") }));
    assert.equal(uploaded.statusCode, 201);
    const photoId = JSON.parse(uploaded.body).photoId;
    const item = { id: "photo-card", type: "주주 구해요", status: "진행중", name: "사진 첨부 테스트", details: "기존 내용\n줄바꿈 유지", resort: "웰리힐리파크", season: "26/27", stayTypes: ["주말"], budgetManwon: 80, photos: [photoId] };
    const event = { requestContext: { http: { method: "PUT" } }, rawPath: "/admin/collections/season-room", pathParameters: { collectionId: "season-room" }, headers: { authorization: "Bearer " + "t".repeat(30) }, body: JSON.stringify({ items: [item] }) };
    const saved = await api.handler(event);
    assert.equal(saved.statusCode, 200, saved.body);
    const read = await api.handler({ requestContext: { http: { method: "GET" } }, rawPath: "/collections/season-room", pathParameters: { collectionId: "season-room" } });
    assert.equal(read.statusCode, 200);
    const restored = JSON.parse(read.body).items[0];
    for (const key of ["type", "status", "details", "resort", "season", "budgetManwon"]) assert.equal(restored[key], item[key]);
    assert.deepEqual(restored.photos, [photoId]);
    assert.deepEqual(restored.stayTypes, ["주말"]);
});

test("현재 공개 게시글도 배포 코드에서 정상 검증", { skip: !process.env.GOYOUNGO_TEST_LIVE_COLLECTION }, async () => {
    const result = await fetch("https://ndx4bl2obl.execute-api.ap-northeast-3.amazonaws.com/collections/season-room");
    assert.equal(result.status, 200);
    const { items } = await result.json();
    const normalized = lambdaHarness().api.validateSeasonItems(items);
    assert.equal(normalized.length, items.length);
    items.forEach((item, index) => {
        for (const key of ["id", "type", "status", "name", "details"]) assert.equal(normalized[index][key], item[key]);
    });
});

test("이미지가 아닌 내용·잘못된 형식·용량 초과를 거부", async () => {
    const { api } = lambdaHarness();
    for (const body of [
        { contentType: "image/svg+xml", data: Buffer.from("<svg/>").toString("base64") },
        { contentType: "image/jpeg", data: Buffer.from("<svg/>").toString("base64") },
        { contentType: "image/jpeg", data: "%%%" }
    ]) assert.equal((await api.handler(uploadEvent(body))).statusCode, 400);
    const data = Buffer.alloc(600 * 1024 + 1).toString("base64");
    assert.equal((await api.handler(uploadEvent({ contentType: "image/jpeg", data }))).statusCode, 413);
});
