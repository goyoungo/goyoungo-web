# Goyoungo Web

GO.YOUNGO의 라이프 디렉터리와 스키장 정보 서비스 SNOWBRO를 제공하는 정적 사이트입니다. 외부 문서 화면을 연결하지 않고 자체 HTML 페이지와 정적 데이터로 구성합니다.

## 기술 구성

- HTML5 / CSS / Vanilla JavaScript
- Kakao JavaScript SDK
- AWS Amplify / CloudFront
- API Gateway HTTP API / Lambda / DynamoDB
- 빌드 과정 없는 다중 정적 페이지 구조

## 주요 경로

- `/`: GO.YOUNGO 서비스 선택형 메인
- `/snowbro/`: 스키장 정보 공유 메인
- `/runbro/`: 목표 레이스·러닝 기록 분석·주간 훈련 계획
- `/snowbro/welpark-restaurants.html`
- `/snowbro/phoenix-restaurants.html`
- `/snowbro/yongpyong-restaurants.html`
- `/snowbro/high1-restaurants.html`
- `/snowbro/marketplace.html`
- `/snowbro/season-room.html`
- `/snowbro/board-cafe.html`
- `/snowbro/shuttle.html`

공통 화면은 `assets/site.css`, `assets/site.js`, `assets/auth.js`를 사용하며, 읽기 전용 데이터 스냅샷은 `assets/site-data.js`에 있습니다.

RUNBRO 화면은 `assets/runbro.css`, `assets/runbro.js`, `assets/runbro-config.js`를 사용합니다. 개인 목표와 Garmin 러닝 기록은 브라우저 저장소가 아닌 별도 AWS API에 저장하며, Garmin 및 Gemini 3.6 Flash·GPT-5.6 Sol 교차 검증 설정은 `backend/RUNBRO_SETUP.md`를 참고하세요.

맛집 추천·비추천과 정보 수정 요청처럼 참여가 필요한 기능만 카카오 로그인을 요청합니다. 맛집 평가는 기존 스냅샷의 평가 수에 카카오 계정 기반 실시간 평가를 더해 표시하며, 한 계정은 맛집마다 한 번 선택할 수 있습니다. 정보 수정 요청은 내용을 복사한 뒤 인스타그램 DM으로 연결합니다. API 구성과 운영 방법은 `backend/README.md`를 참고하세요.

읽기 전용 페이지와 공개 평가 집계 조회에는 로그인이 필요하지 않습니다. 평가 저장 시 백엔드에서 카카오 액세스 토큰을 다시 검증합니다.

## 배포

- 도메인: https://goyoungo.com
- 호스팅: AWS Amplify

## 로컬 미리보기

정적 서버로 이 폴더를 연 뒤 `/?preview=1`에 접속하면 로컬 환경에서 공개 화면과 참여 폼을 미리 볼 수 있습니다. 로그인과 실제 저장은 `localhost`와 `127.0.0.1` 미리보기에서 비활성화됩니다.

## 카카오 로그인 설정

배포 전 확인 사항은 `KAKAO_SETUP.md`를 참고하세요.
