import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import {
    safeErrorCode,
    validateVerifiedResult
} from "./analysis-lib.mjs";

const tableName = process.env.RUNBRO_TABLE_NAME;
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function markFailed(userPk, jobId, errorCode) {
    await documentClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: userPk, sk: `ANALYSIS_JOB#${jobId}` },
        UpdateExpression:
            "SET #status = :status, errorCode = :errorCode, updatedAt = :updatedAt",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
            ":status": errorCode === "codex_auth_required"
                ? "auth_required"
                : "failed",
            ":errorCode": errorCode,
            ":updatedAt": new Date().toISOString()
        }
    }));
}

async function saveResult(userPk, jobId, rawResult) {
    const verified = validateVerifiedResult(rawResult);
    const generatedAt = new Date().toISOString();
    const analysis = {
        ...verified.analysis,
        latestRunAnalysis: verified.latestRunAnalysis,
        recommendation: verified.recommendation,
        trainingPlan: verified.trainingPlan,
        verification: {
            status: "codex_verified",
            verdict: verified.verdict,
            note: verified.verificationNote,
            models: ["gemini-3.6-flash", "codex"],
            generatedAt
        }
    };
    await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: {
            pk: userPk,
            sk: "ANALYSIS",
            analysis,
            sourceJobId: jobId,
            updatedAt: generatedAt
        }
    }));
    await documentClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: userPk, sk: `ANALYSIS_JOB#${jobId}` },
        UpdateExpression:
            "SET #status = :status, completedAt = :completedAt, updatedAt = :updatedAt REMOVE errorCode",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
            ":status": "complete",
            ":completedAt": generatedAt,
            ":updatedAt": generatedAt
        }
    }));
}

async function processRecord(record) {
    const message = JSON.parse(record.body);
    const { userPk, jobId } = message;
    if (
        !/^USER#[a-f0-9]{64}$/.test(String(userPk || "")) ||
        !/^[a-f0-9-]{36}$/.test(String(jobId || ""))
    ) {
        throw new Error("invalid_analysis_result");
    }
    if (message.error) {
        await markFailed(userPk, jobId, safeErrorCode({ message: message.error }));
        return;
    }
    try {
        await saveResult(userPk, jobId, message.result);
    } catch (error) {
        await markFailed(
            userPk,
            jobId,
            safeErrorCode(error, "invalid_codex_result")
        );
    }
}

export async function handler(event) {
    const failures = [];
    for (const record of event.Records || []) {
        try {
            await processRecord(record);
        } catch (error) {
            failures.push({ itemIdentifier: record.messageId });
        }
    }
    return { batchItemFailures: failures };
}
