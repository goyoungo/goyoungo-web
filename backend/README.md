# 카카오 계정 평가 API

`voting-stack.yaml`은 맛집별 추천·비추천과 관리자 콘텐츠 수정을 저장하는 AWS CloudFormation 템플릿입니다.

## 구성

- API Gateway HTTP API
- Node.js Lambda
- DynamoDB On-Demand 테이블
- 카카오 액세스 토큰 서버 검증

브라우저가 전달한 카카오 액세스 토큰은 저장하거나 로그에 남기지 않습니다. Lambda는 카카오 서버에서 토큰의 앱 ID, 만료 여부, 사용자 ID를 확인한 뒤 사용자 ID를 HMAC으로 익명화해 저장합니다.

## API

- `GET /votes?venueIds=<id,id,...>`: 공개 집계 조회. 로그인 토큰이 있으면 현재 계정의 선택도 반환합니다.
- `PUT /votes/{venueId}`: 로그인 계정의 평가 저장. 본문 `choice`는 `recommend`, `not_recommend`, `null` 중 하나입니다.
- `GET /page-overrides?pagePath=<path>`: 공개 페이지 콘텐츠 수정값 조회
- `PUT /admin/pages`: 관리자 카카오 계정의 페이지 글자·링크 수정 저장
- `GET /admin/pages/history?pagePath=<path>`: 관리자 변경 이력 조회
- `GET /collections/marketplace`: 공개 거래 카드 목록 조회
- `PUT /admin/collections/marketplace`: 관리자 거래 카드 추가·수정·삭제 결과 저장
한 계정은 맛집마다 한 표만 가질 수 있습니다. 같은 선택을 다시 저장하면 그대로 유지되고, `null`은 취소입니다.

정보 수정 요청은 사이트에서 인스타그램 DM 안내로 처리하므로 API에 별도로 저장하지 않습니다.

## 보안 설정

- 허용된 운영·테스트 Origin만 CORS로 접근할 수 있습니다.
- 투표 본문은 256바이트로 제한하고, 비정상 Authorization 헤더와 과도하게 긴 토큰을 거부합니다.
- Lambda 동시 실행 수와 API Gateway 요청률을 제한해 비용 폭주와 단순 자동화 공격의 영향을 줄입니다.
- API 응답은 캐시를 금지하고 MIME 스니핑을 차단합니다.
- API Gateway 접근 로그는 인증 헤더와 본문을 제외한 최소 정보만 14일간 보관합니다.

## 배포

```text
aws cloudformation deploy \
  --region ap-northeast-3 \
  --stack-name goyoungo-voting-prod \
  --template-file backend/voting-stack.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides KakaoAppId=1470643 VoteHmacSecret=<secure-random-secret>
```

`VoteHmacSecret`은 일반적인 회전용 비밀이 아니라 기존 사용자 표의 익명 식별 체계를 결정하는 값입니다. 운영 중 값을 바꾸면 기존 계정이 새로운 계정처럼 처리되므로, 별도 마이그레이션 없이 변경하지 말고 안전하게 백업해야 합니다. 실제 값은 저장소나 문서에 커밋하지 않습니다.

테이블은 삭제·교체 시에도 보존되도록 설정되어 있습니다. 스택을 다시 만들거나 이름을 변경할 때는 기존 테이블을 먼저 확인하고, 필요하면 가져오기 또는 데이터 이전 절차를 사용하세요.
