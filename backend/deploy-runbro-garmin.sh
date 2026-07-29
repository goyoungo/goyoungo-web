#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-3}"
STACK_NAME="${RUNBRO_STACK_NAME:-goyoungo-runbro-prod}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ARTIFACT_BUCKET="${RUNBRO_ARTIFACT_BUCKET:-goyoungo-runbro-artifacts-${ACCOUNT_ID}-${REGION}}"
BUILD_ROOT="$(mktemp -d)"
PACKAGE_DIR="${BUILD_ROOT}/package"
ZIP_PATH="${BUILD_ROOT}/runbro-garmin.zip"
BUILD_ID="$(date -u +%Y%m%dT%H%M%SZ)"
CODE_KEY="runbro-garmin/${BUILD_ID}.zip"
TEMPLATE_KEY="runbro-cloudformation/${BUILD_ID}.yaml"

cleanup() {
  rm -rf "${BUILD_ROOT}"
}
trap cleanup EXIT

if ! aws s3api head-bucket --bucket "${ARTIFACT_BUCKET}" >/dev/null 2>&1; then
  if [[ "${REGION}" == "us-east-1" ]]; then
    aws s3api create-bucket \
      --bucket "${ARTIFACT_BUCKET}" \
      --region "${REGION}" >/dev/null
  else
    aws s3api create-bucket \
      --bucket "${ARTIFACT_BUCKET}" \
      --region "${REGION}" \
      --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
  fi
fi

aws s3api put-public-access-block \
  --bucket "${ARTIFACT_BUCKET}" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption \
  --bucket "${ARTIFACT_BUCKET}" \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

mkdir -p "${PACKAGE_DIR}"
python3 -m pip install \
  --disable-pip-version-check \
  --no-compile \
  --only-binary=:all: \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.13 \
  --requirement "${SCRIPT_DIR}/runbro-garmin/requirements.txt" \
  --target "${PACKAGE_DIR}"

cp "${SCRIPT_DIR}/runbro-garmin/app.py" "${PACKAGE_DIR}/app.py"
(
  cd "${PACKAGE_DIR}"
  zip -q -r "${ZIP_PATH}" .
)

aws s3 cp \
  "${ZIP_PATH}" \
  "s3://${ARTIFACT_BUCKET}/${CODE_KEY}" \
  --region "${REGION}" \
  --sse AES256

aws s3 cp \
  "${SCRIPT_DIR}/runbro-stack.yaml" \
  "s3://${ARTIFACT_BUCKET}/${TEMPLATE_KEY}" \
  --region "${REGION}" \
  --sse AES256

aws cloudformation validate-template \
  --region "${REGION}" \
  --template-url "https://${ARTIFACT_BUCKET}.s3.${REGION}.amazonaws.com/${TEMPLATE_KEY}" >/dev/null

aws cloudformation deploy \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file "${SCRIPT_DIR}/runbro-stack.yaml" \
  --s3-bucket "${ARTIFACT_BUCKET}" \
  --s3-prefix "runbro-cloudformation" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "GarminCodeBucket=${ARTIFACT_BUCKET}" \
    "GarminCodeKey=${CODE_KEY}"

aws cloudformation describe-stacks \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table
