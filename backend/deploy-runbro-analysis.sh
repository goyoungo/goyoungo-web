#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-northeast-3}"
RUNBRO_STACK_NAME="${RUNBRO_STACK_NAME:-goyoungo-runbro-prod}"
RUNBRO_ARTIFACT_BUCKET="${RUNBRO_ARTIFACT_BUCKET:-}"
CODEX_VERSION="${CODEX_VERSION:-0.146.0}"
CODEX_AUTH_FILE="${CODEX_AUTH_FILE:-}"
ECR_REPO_NAME="${ECR_REPO_NAME:-${RUNBRO_STACK_NAME}-codex}"

if [[ -z "${RUNBRO_ARTIFACT_BUCKET}" ]]; then
  echo "RUNBRO_ARTIFACT_BUCKET is required." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANALYSIS_DIR="${ROOT_DIR}/backend/runbro-analysis"
CODEX_DIR="${ROOT_DIR}/backend/runbro-codex"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_URL="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

if ! aws ecr describe-repositories \
  --region "${AWS_REGION}" \
  --repository-names "${ECR_REPO_NAME}" >/dev/null 2>&1; then
  aws ecr create-repository \
    --region "${AWS_REGION}" \
    --repository-name "${ECR_REPO_NAME}" \
    --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256 >/dev/null
fi

IMAGE_TAG="$(
  {
    sha256sum "${CODEX_DIR}/Dockerfile"
    sha256sum "${CODEX_DIR}/handler.mjs"
    sha256sum "${CODEX_DIR}/response-schema.json"
    printf '%s' "${CODEX_VERSION}"
  } | sha256sum | cut -c1-16
)"
IMAGE_URI="${ECR_URL}/${ECR_REPO_NAME}:${IMAGE_TAG}"
ANALYSIS_TAG="$(
  {
    sha256sum "${ANALYSIS_DIR}/analysis-lib.mjs"
    sha256sum "${ANALYSIS_DIR}/finalizer.mjs"
  } | sha256sum | cut -c1-16
)"

aws ecr get-login-password --region "${AWS_REGION}" |
  docker login --username AWS --password-stdin "${ECR_URL}"
docker build \
  --platform linux/amd64 \
  --build-arg "CODEX_VERSION=${CODEX_VERSION}" \
  --tag "${IMAGE_URI}" \
  "${CODEX_DIR}"
docker push "${IMAGE_URI}"

cp "${ANALYSIS_DIR}/analysis-lib.mjs" "${BUILD_DIR}/analysis-lib.mjs"
cp "${ANALYSIS_DIR}/finalizer.mjs" "${BUILD_DIR}/finalizer.mjs"
(
  cd "${BUILD_DIR}"
  zip -q analysis-workers.zip analysis-lib.mjs finalizer.mjs
)

ARTIFACT_KEY="runbro/analysis/${ANALYSIS_TAG}/analysis-workers.zip"
aws s3 cp \
  "${BUILD_DIR}/analysis-workers.zip" \
  "s3://${RUNBRO_ARTIFACT_BUCKET}/${ARTIFACT_KEY}" \
  --region "${AWS_REGION}" \
  --only-show-errors

aws cloudformation deploy \
  --region "${AWS_REGION}" \
  --stack-name "${RUNBRO_STACK_NAME}" \
  --template-file "${ROOT_DIR}/backend/runbro-stack.yaml" \
  --s3-bucket "${RUNBRO_ARTIFACT_BUCKET}" \
  --s3-prefix "runbro-cloudformation" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "AnalysisCodeBucket=${RUNBRO_ARTIFACT_BUCKET}" \
    "AnalysisCodeKey=${ARTIFACT_KEY}" \
    "CodexImageUri=${IMAGE_URI}"

if [[ -n "${CODEX_AUTH_FILE}" ]]; then
  if [[ ! -f "${CODEX_AUTH_FILE}" ]]; then
    echo "CODEX_AUTH_FILE does not exist: ${CODEX_AUTH_FILE}" >&2
    exit 1
  fi
  AUTH_BUCKET="$(
    aws cloudformation describe-stacks \
      --region "${AWS_REGION}" \
      --stack-name "${RUNBRO_STACK_NAME}" \
      --query 'Stacks[0].Outputs[?OutputKey==`GarminBucketName`].OutputValue' \
      --output text
  )"
  aws s3 cp \
    "${CODEX_AUTH_FILE}" \
    "s3://${AUTH_BUCKET}/system/codex/auth.json" \
    --region "${AWS_REGION}" \
    --content-type application/json \
    --only-show-errors
fi

aws cloudformation describe-stacks \
  --region "${AWS_REGION}" \
  --stack-name "${RUNBRO_STACK_NAME}" \
  --query 'Stacks[0].Outputs' \
  --output table
