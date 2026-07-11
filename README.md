# Goyoungo Web

카카오 로그인 후 공개되는 스키장 정보 공유 사이트입니다. 기존 Notion의 문서와 데이터베이스를 외부 링크로 연결하지 않고, 자체 HTML 페이지와 정적 데이터로 재구성합니다.

## 기술 구성

- HTML5 / CSS / Vanilla JavaScript
- Kakao JavaScript SDK
- AWS Amplify / CloudFront
- 빌드 과정 없는 다중 정적 페이지 구조

## 자체 페이지

- `/welpark-restaurants.html`
- `/phoenix-restaurants.html`
- `/yongpyong-restaurants.html`
- `/high1-restaurants.html`
- `/marketplace.html`
- `/season-room.html`
- `/board-cafe.html`
- `/shuttle.html`

공통 화면은 `assets/site.css`, `assets/site.js`, `assets/auth.js`를 사용하며, Notion에서 복사한 읽기 전용 스냅샷은 `assets/site-data.js`에 있습니다.

> 현재 카카오 로그인은 정적 사이트의 화면 접근을 제어하는 방식입니다. 정적 파일 자체를 서버에서 비공개로 보호해야 한다면 별도의 인증 백엔드나 엣지 접근 제어가 필요합니다.

## 배포

- 도메인: https://goyoungo.com
- 호스팅: AWS Amplify

## 로컬 미리보기

정적 서버로 이 폴더를 연 뒤 `/?preview=1`에 접속하면 로컬 환경에서 카카오 로그인 없이 로그인 후 화면을 확인할 수 있습니다. 이 미리보기 우회는 `localhost`와 `127.0.0.1`에서만 동작합니다.

## 카카오 로그인 설정

배포 전 확인 사항은 `KAKAO_SETUP.md`를 참고하세요.
