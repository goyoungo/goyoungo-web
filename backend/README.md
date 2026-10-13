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
- `GET /collections/{marketplace|season-room|shuttle}`: 공개 카드 목록 조회
- `PUT /admin/collections/{marketplace|season-room|shuttle}`: 관리자 카드 추가·수정·삭제 결과 저장
- `POST /admin/season-photos`: 관리자 사진 업로드. JSON `contentType`, `data`(base64)를 받고 `photoId`를 반환합니다.
- `GET /season-photos/{photoId}`: 공개 게시판에 첨부한 사진 조회
한 계정은 맛집마다 한 표만 가질 수 있습니다. 같은 선택을 다시 저장하면 그대로 유지되고, `null`은 취소입니다.

정보 수정 요청은 사이트에서 인스타그램 DM 안내로 처리하므로 API에 별도로 저장하지 않습니다.

## 시즌방 게시판

- 모집 목적·스키장·시즌·이용 형태·상태·대표 시즌 비용으로 필터링합니다. 완료 글은 항상 뒤로 정렬하고, 상태가 같으면 최근 수정순으로 표시합니다.
- 추가 필드: `resort`, `season`(예: `26/27`), `stayTypes`, `budgetManwon`, `photos`(사진 식별자 배열). 기존 카드의 모든 필드와 본문은 유지되며, 새 필드가 없는 카드도 지원합니다.
- 비용이 입력되지 않은 글은 예산 필터를 켰을 때 제외합니다. 기존 자유 입력 금액은 별도로 유지합니다.
- 관리자 편집창은 사진 선택·드래그 앤 드롭·클립보드 이미지 붙여넣기를 지원합니다. 텍스트 붙여넣기는 정상적으로 작동합니다.
- 최대 6장, 한 장은 브라우저에서 최대 긴 변 1600px·600KB의 JPEG로 변환합니다. 선택 시에는 로컬 미리보기만 만들고, 저장 버튼을 누를 때 업로드합니다.
- 사진은 AES256으로 암호화된 비공개 S3 버킷에 저장하며, 공개 조회는 API로 제공합니다. S3 공개 접근은 차단되고 Lambda는 사진 경로만 읽고 쓸 수 있습니다. 업로드는 기존 카카오 관리자 권한을 서버에서 확인합니다.
- 버킷과 기존 테이블은 스택 삭제·교체 시 보존됩니다. 글에서 사진을 빼도 변경 이력 복원을 위해 기존 사진 객체를 자동 삭제하지 않습니다.
- 서버 템플릿을 먼저 업데이트하고 `UPDATE_COMPLETE`를 확인한 후 프론트엔드를 게시하세요. 새 필드는 이전 서버에서 지원하지 않으므로 순서를 바꾸지 않습니다. 기존 `VoteHmacSecret` 및 관리자 ID 파라미터는 유지하세요.

검증: `node --test backend/tests/season-board.test.cjs`

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
