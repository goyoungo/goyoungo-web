# RUNBRO 연동 설정

RUNBRO는 목표 레이스, 컨디션, 러닝 활동을 카카오 계정 기준의 가명 사용자 ID에 저장합니다. 외부 서비스 토큰은 AWS KMS로 암호화하며 브라우저나 정적 파일에 저장하지 않습니다.

## 지원 범위

- 목표 레이스 날짜·거리·목표 기록 저장
- 최근 4주 거리, 평균 페이스, 예상 완주 기록, 준비도 분석
- 주간 훈련 스케줄 생성
- Strava OAuth 2.0 연결과 최근 120일 러닝 동기화
- Gemini 2.5 Flash를 이용한 선택적 해설
- 연결 토큰, 러닝 기록, 프로필 전체 삭제
- Garmin Connect 직접 연동을 위한 화면과 공급자 분기

## Strava

1. Strava API 설정에서 애플리케이션을 등록합니다.
2. Authorization Callback Domain을 `goyoungo.com`으로 설정합니다.
3. 콜백 주소는 `https://goyoungo.com/runbro/callback.html`을 사용합니다.
4. CloudFormation 배포 시 `StravaClientId`와 `StravaClientSecret`을 전달합니다.

요청 범위는 프로필 기본 읽기와 러닝 활동 읽기에 필요한 `read,activity:read_all`로 제한합니다. 액세스 토큰은 6시간 만료 전에 서버에서 갱신하고 새 리프레시 토큰으로 교체합니다.

## Garmin Connect

Garmin Connect 데이터 API는 일반 공개 키만으로 바로 사용할 수 없으며 Garmin Connect Developer Program 신청과 승인이 필요합니다. 승인 후 제공되는 개발자 포털 문서, OAuth 앱 정보, Activity API 또는 Health API 전달 방식을 기준으로 백엔드 어댑터를 활성화해야 합니다.

승인 전에는 Garmin Connect에서 Strava 자동 공유를 켜고 RUNBRO에 Strava를 연결하면 Garmin 러닝 기록을 동일하게 가져올 수 있습니다.

- 프로그램 안내: https://developer.garmin.com/gc-developer-program/overview/
- Health API: https://developer.garmin.com/gc-developer-program/health-api/

## 배포

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
    GeminiApiKey=<gemini-api-key>
```

배포 출력의 `ApiEndpoint`를 `assets/runbro-config.js`의 `apiBase`에 설정합니다. 운영 키와 비밀 값은 저장소에 커밋하지 않습니다.

## 개인정보와 안전

- 카카오 사용자 ID는 HMAC-SHA256으로 가명 처리합니다.
- Strava 액세스·리프레시 토큰은 사용자·공급자 암호화 컨텍스트와 함께 KMS로 암호화합니다.
- Gemini에는 이름, 계정 ID, 활동 경로, 위치, 정확한 시작 시각을 보내지 않고 4주 거리·평균 페이스·목표·컨디션 집계만 전달합니다.
- 분석은 의료 진단이 아니며 과훈련을 조장하지 않도록 거리 급증과 회복을 우선 확인합니다.
- 전체 삭제 시 Strava 토큰 폐기를 요청하고 DynamoDB의 사용자 파티션을 제거합니다.
