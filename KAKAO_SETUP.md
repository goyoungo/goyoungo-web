# 카카오 디벨로퍼스 설정 가이드

## 필수 설정 (배포 전 완료 필요)

### 1. Web 플랫폼 등록
https://developers.kakao.com → 앱 선택 → "앱 설정" → "플랫폼"

**Web 플랫폼 등록**:
- `https://goyoungo.com`
- `https://www.goyoungo.com`

### 2. 카카오 로그인 활성화
"제품 설정" → "카카오 로그인" → **활성화 상태: ON**

### 3. Redirect URI 등록
"제품 설정" → "카카오 로그인" → "Redirect URI"

**추가할 URI**:
- `https://goyoungo.com/index.html`
- `https://www.goyoungo.com/index.html`
- `https://goyoungo.com/` (optional)
- `https://www.goyoungo.com/` (optional)

### 4. 동의 항목 설정
"제품 설정" → "카카오 로그인" → "동의항목"

**필수 설정**:
- ✅ 닉네임 (필수 동의)
- ✅ 프로필 사진 (필수 동의)

---

## 배포 후 Amplify URL 추가

Amplify가 생성한 임시 URL도 추가:
- 예: `https://main.xxxxx.amplifyapp.com`

위 설정을 먼저 완료하셨나요?
