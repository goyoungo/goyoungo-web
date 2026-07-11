# 카카오 디벨로퍼스 설정 가이드

## 필수 설정

### 1. Web 플랫폼 등록

카카오 디벨로퍼스에서 앱을 선택한 뒤 `앱 설정` → `플랫폼`에 다음 사이트를 등록합니다.

- `https://goyoungo.com`
- `https://www.goyoungo.com`을 실제 서비스할 때만 추가

### 2. 카카오 로그인 활성화

`제품 설정` → `카카오 로그인`에서 활성화 상태를 `ON`으로 설정합니다.

### 3. Redirect URI 등록

현재 페이지는 레거시 JavaScript SDK 팝업 로그인을 사용합니다. 카카오 앱 설정에 실제 서비스 주소를 등록합니다.

- `https://goyoungo.com/`
- `https://goyoungo.com/index.html`

AWS Amplify의 임시 주소에서도 확인해야 한다면 해당 HTTPS 주소도 Web 플랫폼에 추가합니다.

### 4. 동의 항목

이 사이트는 로그인 여부만 사용하며 닉네임이나 프로필 사진을 조회하지 않습니다. 프로필 정보 동의를 필수로 요구하지 마세요.

## 유지보수 참고

현재 인증 흐름은 Kakao JavaScript SDK v1 콜백 방식입니다. SDK 파일은 카카오 공식 Legacy CDN 주소인 `https://t1.kakaocdn.net/kakao_js_sdk/v1/kakao.min.js`에서 불러옵니다. 광고·추적 차단 기능을 사용한다면 `t1.kakaocdn.net`을 허용해야 합니다.

Legacy v1은 2026년 12월 31일 지원 종료 예정이므로, 그 전에 v2의 `Kakao.Auth.authorize()`와 서버 측 인가 코드·토큰 교환 방식으로 전환해야 합니다.
