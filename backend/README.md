# 카카오 계정 평가 API

`voting-stack.yaml`은 맛집별 추천·비추천과 정보 수정 요청을 저장하는 AWS CloudFormation 템플릿입니다.

## 구성

- API Gateway HTTP API
- Node.js Lambda
- DynamoDB On-Demand 테이블
- 카카오 액세스 토큰 서버 검증

브라우저가 전달한 카카오 액세스 토큰은 저장하거나 로그에 남기지 않습니다. Lambda는 카카오 서버에서 토큰의 앱 ID, 만료 여부, 사용자 ID를 확인한 뒤 사용자 ID를 HMAC으로 익명화해 저장합니다.

## API

- `GET /votes?venueIds=<id,id,...>`: 공개 집계 조회. 로그인 토큰이 있으면 현재 계정의 선택도 반환합니다.
- `PUT /votes/{venueId}`: 로그인 계정의 평가 저장. 본문 `choice`는 `recommend`, `not_recommend`, `null` 중 하나입니다.
- `POST /suggestions`: 로그인 계정의 정보 수정 요청 저장. `category`, `target`, `details`, `pageUrl`을 받습니다.

한 계정은 맛집마다 한 표만 가질 수 있습니다. 같은 선택을 다시 저장하면 그대로 유지되고, `null`은 취소입니다.

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
