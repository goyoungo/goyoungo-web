# RUNBRO 연동 설정

RUNBRO는 목표 레이스, 컨디션, 러닝 활동을 카카오 계정 기준의 가명 사용자 ID에 저장합니다. 외부 서비스 토큰은 브라우저나 정적 파일에 저장하지 않습니다.

## 지원 범위

- 목표 레이스 날짜·거리·목표 기록 저장
- 최근 러닝을 인터벌·템포·존2·장거리·회복런으로 자동 분류
- 최근 4·8·12주 거리, VDOT 추정치, 심박존 추세와 준비도 분석
- 추천 내용과 근거를 함께 제시하는 다음 훈련 제안
- 날짜가 지정된 7일 계획과 월간 훈련 달력
- Garmin Connect 로그인·MFA와 최근 러닝·수면·HRV·훈련 준비도 동기화
- Gemini 3.6 Flash 1차 분석과 카카오 계정 기반 ChatGPT 앱 교차검증
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

기존 `goyoungo-runbro-prod` 스택을 업데이트할 때 AWS CloudShell에서 저장소를 받은 뒤 다음 스크립트를 실행합니다.

```text
bash backend/deploy-runbro-garmin.sh
```

스크립트는 다음 작업을 수행합니다.

1. Linux x86_64·Python 3.13용 Lambda 의존성을 임시 폴더에 설치합니다.
2. 고유한 S3 키로 배포 ZIP과 CloudFormation 템플릿을 업로드합니다.
3. S3 템플릿 URL로 CloudFormation 템플릿을 검증합니다.
4. `GarminCodeBucket`, `GarminCodeKey`를 전달해 기존 스택을 업데이트합니다.

환경별로 값을 바꾸려면 실행 전에 설정합니다.

```text
export AWS_REGION=ap-northeast-3
export RUNBRO_STACK_NAME=goyoungo-runbro-prod
export RUNBRO_ARTIFACT_BUCKET=<기존 또는 새 배포 파일 버킷>
bash backend/deploy-runbro-garmin.sh
```

새 스택을 만드는 경우에는 기존 필수 비밀 값도 함께 전달해야 합니다.

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
    GeminiApiKey=<gemini-api-key> \
    GarminCodeBucket=<artifact-bucket> \
    GarminCodeKey=<artifact-key>
```

배포 출력의 `ApiEndpoint`는 기존 `assets/runbro-config.js`의 `apiBase`와 같아야 합니다. 운영 키와 비밀 값은 저장소나 명령 기록에 커밋하지 않습니다.

## ChatGPT 앱 연결

OpenAI API 키를 서버에 저장하거나 RUNBRO 서버에서 ChatGPT API를 직접 호출하지 않습니다. 대신 배포된 API 자체가 OAuth 2.1 보호 MCP 서버로 동작하고, 사용자가 ChatGPT에서 RUNBRO 앱에 카카오 계정 접근 권한을 승인합니다.

1. ChatGPT 앱/커넥터 개발 화면에서 원격 MCP 서버를 추가합니다.
2. 서버 URL은 배포 출력의 `ApiEndpoint` 뒤에 `/mcp`를 붙인 주소를 사용합니다.
3. 인증 방식은 OAuth를 선택합니다. 서버는 보호 리소스·인증 서버 메타데이터, 동적 클라이언트 등록, PKCE S256, 액세스·리프레시 토큰 회전을 제공합니다.
4. 앱 연결 화면에서 카카오 로그인 후 `러닝 요약 읽기`와 `검증 결과 저장` 권한을 승인합니다.
5. RUNBRO 화면의 `ChatGPT로 상세 검증`을 누르고 다음 요청을 실행합니다.

```text
RUNBRO 앱으로 내 최근 러닝 기록과 Gemini 1차 분석을 교차검증하고,
다음 훈련의 내용과 근거 및 7일 계획을 저장해줘.
```

MCP 도구는 다음 두 개입니다.

- `get_running_snapshot`: 목표 레이스, 4·8·12주 집계, 러닝 자동 분류, VDOT·심박존·회복 지표, Gemini 1차 분석을 읽습니다.
- `save_verified_analysis`: 사용자가 저장을 명시적으로 승인한 뒤 ChatGPT의 검증 결과, 근거형 다음 훈련 제안, 7일 계획을 저장합니다.

MCP 서버 URL과 OAuth 메타데이터 예시는 다음과 같습니다.

```text
https://<api-id>.execute-api.ap-northeast-3.amazonaws.com/mcp
https://<api-id>.execute-api.ap-northeast-3.amazonaws.com/.well-known/oauth-protected-resource/mcp
https://<api-id>.execute-api.ap-northeast-3.amazonaws.com/.well-known/oauth-authorization-server
```

## 테스트

```text
python -m unittest discover -s backend/runbro-garmin/tests -v
node --check assets/runbro.js
```

실제 계정 테스트는 카카오 로그인 후 RUNBRO의 Garmin 연결 창에서 진행합니다. MFA를 사용하는 계정이면 Garmin이 보낸 일회용 코드를 입력하고, 동기화 후 최근 러닝과 건강 요약이 현재 상태 분석에 반영되는지 확인합니다.

## 개인정보와 안전

- 카카오 사용자 ID는 HMAC-SHA256으로 가명 처리합니다.
- Strava 액세스·리프레시 토큰은 사용자·공급자 암호화 컨텍스트와 함께 KMS로 암호화합니다.
- Garmin 토큰과 데이터는 공개 접근이 차단된 전용 S3 버킷에서 KMS로 암호화합니다.
- Gemini에는 이름, 계정 ID, 활동 경로, 위치, 정확한 시작 시각을 보내지 않고 거리·평균 페이스·목표·컨디션 집계만 전달합니다.
- ChatGPT 앱은 사용자가 승인한 카카오 계정의 익명 집계만 읽습니다. 카카오 ID, Garmin 토큰·비밀번호, 경로·좌표, 활동명, 정확한 시작 시각은 MCP 응답에 포함하지 않습니다.
- OAuth 액세스 토큰은 원문 대신 SHA-256 해시로 DynamoDB에 저장하고 1시간 후 만료합니다. 리프레시 토큰은 회전하며 30일 후 만료합니다.
- RUNBRO 계정 삭제 시 사용자 파티션의 ChatGPT 권한도 제거되므로 발급된 토큰은 즉시 사용할 수 없게 됩니다.
- 분석은 의료 진단이 아니며 거리 급증과 회복을 우선 확인합니다.
- 전체 삭제 시 Strava 토큰 폐기를 요청하고 DynamoDB 사용자 파티션과 Garmin S3 사용자 경로를 제거합니다.
