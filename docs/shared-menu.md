# SNOWBRO 공통 메뉴

- 기본 메뉴명은 `assets/site-data.js`의 `pages[pageId].title` 한 곳에서 관리합니다. `navigation[].title`은 이 값을 직접 참조합니다.
- 사이드바, SNOWBRO 홈 카드, 해당 페이지의 제목과 이동 경로는 같은 `data-page-sync-id`를 사용합니다.
- 관리자 `페이지 수정`에서 공통 메뉴명이나 이동 링크를 수정하고 저장하면 `/admin/pages`의 `pagePath: "/snowbro/"`에 저장합니다. 방문자는 로그인 없이 `/page-overrides`로 같은 공통 값을 읽습니다.
- 이동 링크에는 별도의 `data-page-link-sync-id`를 사용합니다. 아이콘·카드 순번·설명은 링크 주소와 섞이지 않습니다.
- 한 화면에 같은 메뉴가 여러 번 나오면 입력 중에도 함께 갱신하며, 취소하면 모두 마지막 저장값으로 돌아옵니다.
- 본문 등 페이지 고유 항목과 기존 블로그 동기화는 기존 저장 경로를 유지합니다. 과거 페이지별 메뉴 수정 기록은 삭제하지 않으며 새 공통 키와 분리됩니다.
- 이번 변경은 셔틀 메뉴명만 `26/27 셔틀 정보`로 갱신합니다. 업체 카드와 예약 링크를 새 시즌 정보로 간주하거나 변경하지 않습니다.

검증:

```text
node backend/tests/shared-menu.browser.cjs
```

로컬 정적 서버 기본 주소는 `http://127.0.0.1:8132`이며 `GOYOUNGO_PREVIEW_URL`로 변경할 수 있습니다. Playwright 경로는 `GOYOUNGO_PLAYWRIGHT_ROOT`, 기존 Chromium 실행 파일은 `GOYOUNGO_CHROMIUM_PATH`로 지정합니다. 테스트는 API와 카카오 인증을 모킹하므로 운영 데이터를 수정하지 않습니다.
