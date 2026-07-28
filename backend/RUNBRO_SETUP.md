# RUNBRO 연동 설정

RUNBRO는 목표 레이스, 컨디션, 러닝 활동을 카카오 계정 기준의 가명 사용자 ID에 저장합니다. 외부 서비스 토큰은 브라우저나 정적 파일에 저장하지 않습니다.

## 지원 범위

- 목표 레이스 날짜·거리·목표 기록 저장
- 최근 4주 거리, 평균 페이스, 예상 완주 기록, 준비도 분석
- 주간 훈련 스케줄 생성
- Garmin Connect 로그인·MFA와 최근 러닝·수면·HRV·훈련 준비도 동기화
- Strava OAuth 2.0 연결과 최근 120일 러닝 동기화
- Gemini 3.6 Flash 1차 분석과 GPT-5.6 Sol 2차 교차 검증
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

## Strava

1. Strava API 설정에서 애플리케이션을 등록합니다.
2. Authorization Callback Domain을 `goyoungo.com`으로 설정합니다.
3. 콜백 주소는 `https://goyoungo.com/runbro/callback.html`을 사용합니다.
4. CloudFormation 배포 시 `StravaClientId`와 `StravaClientSecret`을 전달합니다.

요청 범위는 프로필 기본 읽기와 러닝 활동 읽기에 필요한 `read,activity:read_all`로 제한합니다. 액세스 토큰은 만료 전에 서버에서 갱신하고 새 리프레시 토큰으로 교체합니다.

## 배포

기존 `goyoungo-runbro-prod` 스택을 업데이트할 때 AWS CloudShell에서 저장소를 받은 뒤 다음 스크립트를 실행합니다.

```text
bash backend/deploy-runbro-garmin.sh
```

스크립트는 다음 작업을 수행합니다.

1. Linux x86_64·Python 3.13용 Lambda 의존성을 임시 폴더에 설치합니다.
2. 고유한 S3 키로 배포 ZIP을 업로드합니다.
3. CloudFormation 템플릿을 검증합니다.
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
    OpenAIApiKey=<openai-api-key> \
    GarminCodeBucket=<artifact-bucket> \
    GarminCodeKey=<artifact-key>
```

배포 출력의 `ApiEndpoint`는 기존 `assets/runbro-config.js`의 `apiBase`와 같아야 합니다. 운영 키와 비밀 값은 저장소나 명령 기록에 커밋하지 않습니다.

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
- Gemini와 OpenAI에는 이름, 계정 ID, 활동 경로, 위치, 정확한 시작 시각을 보내지 않고 4주 거리·평균 페이스·목표·컨디션 집계만 전달합니다.
- Gemini 3.6 Flash가 1차 분석하고 GPT-5.6 Sol이 같은 익명 집계와 1차 결과를 대조해 확인하거나 조정합니다. 한 공급자가 응답하지 않으면 화면에 단일 모델 분석임을 표시합니다.
- OpenAI 요청은 응답 저장을 끄고, 카카오 사용자 ID와 분리된 추가 HMAC 값만 안전 식별자로 전달합니다.
- 분석은 의료 진단이 아니며 거리 급증과 회복을 우선 확인합니다.
- 전체 삭제 시 Strava 토큰 폐기를 요청하고 DynamoDB 사용자 파티션과 Garmin S3 사용자 경로를 제거합니다.
