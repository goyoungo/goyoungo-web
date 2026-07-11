# Goyoungo Web

카카오 로그인 후 공개되는 스키장 정보 공유 허브입니다. 기존 Notion 상위 페이지의 어두운 테마, 링크 순서, 간격, 하위 페이지 연결과 Apption 댓글 위젯을 정적 HTML로 재현합니다.

## 기술 구성

- HTML5 / CSS / Vanilla JavaScript
- Kakao JavaScript SDK
- AWS Amplify / CloudFront

## 배포

- 도메인: https://goyoungo.com
- 호스팅: AWS Amplify

## 로컬 미리보기

정적 서버로 이 폴더를 연 뒤 `/?preview=1`에 접속하면 로컬 환경에서 카카오 로그인 없이 로그인 후 화면을 확인할 수 있습니다. 이 미리보기 우회는 `localhost`와 `127.0.0.1`에서만 동작합니다.

## 카카오 로그인 설정

배포 전 확인 사항은 `KAKAO_SETUP.md`를 참고하세요.
