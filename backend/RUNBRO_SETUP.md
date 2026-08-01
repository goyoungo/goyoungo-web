# RUNBRO 연동 설정

RUNBRO는 목표 레이스, 컨디션, 러닝 활동을 카카오 계정 기준의 가명 사용자 ID에 저장합니다. 외부 서비스 토큰은 브라우저나 정적 파일에 저장하지 않습니다.

## 지원 범위

- 목표 레이스 날짜·거리·목표 기록 저장
- 최근 러닝을 인터벌·템포·존2·장거리·회복런으로 자동 분류
- 최근 4·8·12주 거리, VDOT 추정치, 심박존 추세와 준비도 분석
- 추천 내용과 근거를 함께 제시하는 다음 훈련 제안
- 날짜가 지정된 7일 계획과 월간 훈련 달력
- Garmin Connect 로그인·MFA와 최근 러닝·수면·HRV·훈련 준비도 동기화
- 최근 12주 개별 러닝과 회복 수치를 사용하는 Codex 직접 분석
- 연결 토큰, 러닝 기록, 프로필 전체 삭제

## Garmin Connect

`backend/runbro-garmin/app.py`는 MCP나 상시 실행 컨테이너 없이 요청마다 실행되는 Python Lambda입니다. `garminconnect` 라이브러리로 Garmin Connect에 로그인하고, 이후 갱신 가능한 토큰을 카카오 계정별 S3 경로에 저장합니다.

- Garmin 이메일과 비밀번호는 최초 로그인 요청에만 사용하고 저장하거나 로그에 남기지 않습니다.
- MFA가 필요한 경우 5분 동안만 사용할 수 있는 이어받기 상태를 SSE-KMS 암호화 S3 객체로 저장합니다.
- 완료되지 않은 MFA 상태와 동기화 잠금 객체에는 수명 주기 태그를 붙여 1일 안에 자동 정리합니다.
- 토큰과 정규화된 러닝·건강 요약은 S3 기본 SSE-KMS와 버킷 키를 사용합니다.
- 활동 경로 좌표, 활동 설명, Garmin의 원본 건강 응답은 저장하지 않습니다.
- 카카오 계정마다 HMAC-SHA256 가명 경로가 달라 다른 사용자의 토큰이나 기록을 읽을 수 없습니다.
- 연결 및 기록 삭제 시 해당 사용자 경로의 현재 객체, 이전 버전, 삭제 마커를 모두 제거합니다.

이 연결은 Garmin 공식 파트너 API가 아닌 비공식 `garminconnect` 연동입니다. Garmin 정책·로그인 방식·호출 제한이 바뀌면 기능이 중단될 수 있으므로 베타 기능으로 운영하고, 장애 시 사용자에게 재연결을 안내해야 합니다.

## 기존 Strava 호환 경로

현재 RUNBRO 화면에는 Strava 연결을 노출하지 않습니다. 기존 사용자 데이터 정리와 이전 배포 호환을 위해 백엔드 파라미터와 폐기 경로만 유지하며, 새 배포에서는 `StravaClientId`와 `StravaClientSecret`을 빈 값으로 둘 수 있습니다.

기존 연동을 계속 운영하는 경우에만 Authorization Callback Domain을 `goyoungo.com`, 콜백 주소를 `https://goyoungo.com/runbro/callback.html`로 설정합니다. 요청 범위는 `read,activity:read_all`이며, 액세스 토큰은 서버에서 갱신·회전합니다.

## 배포

Garmin Lambda만 갱신할 때는 기존 스크립트를 사용합니다.

```text
bash backend/deploy-runbro-garmin.sh
```

Codex 자동 분석 파이프라인을 배포할 때는 AWS CloudShell에서 다음 스크립트를 사용합니다. CloudShell은 Docker를 기본 제공하므로 Codex Lambda 컨테이너를 빌드해 ECR에 올리고, 결과 저장 Lambda ZIP과 CloudFormation 스택을 함께 갱신합니다.

```text
export AWS_REGION=ap-northeast-3
export RUNBRO_STACK_NAME=goyoungo-runbro-prod
export RUNBRO_ARTIFACT_BUCKET=<기존 배포 파일 버킷>
export CODEX_AUTH_FILE=$HOME/auth.json
bash backend/deploy-runbro-analysis.sh
```

`CODEX_AUTH_FILE`은 신뢰할 수 있는 PC에서 `codex login`으로 만든 파일 기반 인증 캐시입니다. 저장소에 넣지 말고 CloudShell 파일 업로드 기능으로 일시적으로 올린 뒤 사용합니다. 스크립트는 이를 공개 접근이 차단된 RUNBRO S3 버킷의 `system/codex/auth.json`에 저장하며, 버킷 기본 KMS 키로 암호화합니다.

인증 파일을 전달하지 않아도 인프라는 배포되지만 Codex 검증 작업은 `auth_required` 상태가 됩니다. 인증 파일은 한 개의 직렬 Codex Lambda만 사용하고 실행 후 갱신본을 같은 S3 객체에 다시 저장합니다.

새 스택을 만드는 경우에는 기존 필수 비밀 값과 분석용 세 값을 모두 전달해야 합니다.

```text
aws cloudformation deploy \
  --region ap-northeast-3 \
  --stack-name goyoungo-runbro-prod \
  --template-file backend/runbro-stack.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    KakaoAppId=1470643 \
    UserHmacSecret=<secure-random-secret> \
    OAuthStateSecret=<secure-random-secret> \
    StravaClientId=<strava-client-id> \
    StravaClientSecret=<strava-client-secret> \
    GarminCodeBucket=<artifact-bucket> \
    GarminCodeKey=<artifact-key> \
    AnalysisCodeBucket=<artifact-bucket> \
    AnalysisCodeKey=<analysis-artifact-key> \
    CodexImageUri=<ecr-image-uri>
```

배포 출력의 `ApiEndpoint`는 기존 `assets/runbro-config.js`의 `apiBase`와 같아야 합니다. 운영 키와 비밀 값은 저장소나 명령 기록에 커밋하지 않습니다.

## 자동 분석 흐름

OpenAI API는 사용하지 않습니다. 카카오 로그인 사용자가 분석을 요청하면 공개 API는 즉시 작업 번호만 반환하고 다음 순서로 비동기 처리합니다.

1. API Lambda가 최근 12주 개별 러닝, 주간 추세, 심박존, 회복 수치와 작업 번호를 암호화된 Codex FIFO 대기열에 넣습니다.
2. 하나의 Codex Lambda가 작업을 직렬로 받아 읽기 전용·비대화형 모드에서 직접 분석합니다.
3. 결과 저장 Lambda가 JSON 형식, 문자열 길이, 훈련 유형, 7일 계획을 다시 검사한 뒤 DynamoDB에 저장합니다.
4. RUNBRO 화면은 작업 상태를 조회해 완료된 결과를 자동으로 반영합니다.

기존 ChatGPT 앱용 OAuth/MCP 경로는 이전 연결 호환성을 위해 보호된 상태로 남아 있지만 RUNBRO 화면에서는 호출하지 않습니다.

## 테스트

```text
python -m unittest discover -s backend/runbro-garmin/tests -v
node --test backend/runbro-analysis/tests/analysis-lib.test.mjs
node --check assets/runbro.js
```

실제 계정 테스트는 카카오 로그인 후 RUNBRO의 Garmin 연결 창에서 진행합니다. MFA를 사용하는 계정이면 Garmin이 보낸 일회용 코드를 입력하고, 동기화 후 최근 러닝과 건강 요약이 현재 상태 분석에 반영되는지 확인합니다.

## 개인정보와 안전

- 카카오 사용자 ID는 HMAC-SHA256으로 가명 처리합니다.
- Strava 액세스·리프레시 토큰은 사용자·공급자 암호화 컨텍스트와 함께 KMS로 암호화합니다.
- Garmin 토큰과 데이터는 공개 접근이 차단된 전용 S3 버킷에서 KMS로 암호화합니다.
- Codex에는 최근 12주 개별 러닝의 날짜, 거리, 시간, 페이스, 고도, 평균·최대 심박과 Garmin 회복 수치를 전달합니다. 이름, 계정 ID, 활동 경로, 위치, 활동명, 정확한 시작 시각은 전달하지 않습니다.
- SQS 메시지는 SSE-SQS로 암호화하고 1시간 후 삭제하며, 처리 실패 대기열도 1일 후 삭제합니다.
- Codex 인증 캐시는 RUNBRO S3 버킷에서 KMS로 암호화하고 Codex Lambda 역할만 읽고 갱신할 수 있습니다. 이전 객체 버전은 1일 후 삭제합니다.
- Codex는 사용자별 세션을 이어 쓰지 않고 작업마다 임시 디렉터리에서 새 비대화형 세션으로 실행합니다.
- OAuth 액세스 토큰은 원문 대신 SHA-256 해시로 DynamoDB에 저장하고 1시간 후 만료합니다. 리프레시 토큰은 회전하며 30일 후 만료합니다.
- RUNBRO 계정 삭제 시 사용자 파티션의 ChatGPT 권한도 제거되므로 발급된 토큰은 즉시 사용할 수 없게 됩니다.
- 분석은 의료 진단이 아니며 거리 급증과 회복을 우선 확인합니다.
- 전체 삭제 시 Strava 토큰 폐기를 요청하고 DynamoDB 사용자 파티션과 Garmin S3 사용자 경로를 제거합니다.
