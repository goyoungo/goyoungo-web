const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function sourceLambdaCode() {
    const template = fs.readFileSync(path.join(__dirname, "../voting-stack.yaml"), "utf8");
    return template.split(/ZipFile: \|\r?\n/)[1].split(/\r?\n  VoteApi:/)[0].split(/\r?\n/).map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");
}

function lambdaHarness(userId = "1", options = {}) {
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
        fetch: async () => ({ ok: true, text: async () => JSON.stringify({ id: +userId, app_id: 1470643, expires_in: options.expiresIn ?? 3600 }) }),
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

module.exports = { sourceLambdaCode, lambdaHarness };
