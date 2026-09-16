# 공동 장부 개인 콘텐츠 · 전향적 소유 추적 후보

2026-09-16. 로컬 구현/격리 검사이며 운영에 적용하지 않았다. 다섯 번째 migration `20260916043911_attributed_account_content_cleanup.sql`을 앞선 네 migration 뒤에 적용해야 한다. 새 서버는 이 schema 이후에 배포한다.

## 기존 근거와 보수적인 범위

`expenses`/`incomes.created_by_member_id`는 최초 기록자다. 누구나 메모를 편집할 수 있어 현재 문장의 단독 작성자 증거가 아니다. 사진에도 영구 업로더 열이 없고 `image_upload_operations`는 성공 뒤 지워진다. 기존 데이터를 결제자/기록자/이름/같은 문자열로 추정해 귀속시키거나 삭제하지 않는다.

앞으로 서버가 확인한 현재 pass를 `content_actor`로 전달한다. 이 임시 값은 DB trigger가 member/user/장부를 다시 검증한 후 NULL로 지우며, 비공개 `content_ownership`에는 member UUID와 필드 값의 SHA-256만 보관한다. 앱 응답에 소유 증거를 내보내지 않는다.

- 추적하는 지출 필드: 제목, 메모, 판매처, 분류, 묶음, 링크, 보정 사유, 영수증/대표 사진.
- 수입: 제목과 메모.
- 처음 만든 문장, 비어 있던 필드에 쓴 문장, 같은 작성자가 수정한 문장은 단독 소유 증거를 유지한다. 다른 사람이 기존 문장을 편집하거나 구 서버가 작성자 없이 변경하면 혼합/불명으로 바꾼다. 다른 사람의 단어를 포함할 수 있는 문장 전체를 마지막 편집자의 것이라고 단정하지 않는다.
- 사진은 같은 검증된 member의 정확한 새 업로드 reservation이 있을 때만 업로더로 귀속한다. 다른 기록의 경로를 복사한 것만으로 소유권을 얻지 못한다. 완료 뒤 reservation을 지워도 별도 소유 증거는 남는다.
- 게스트가 계정에 연결되면 동일 member를 통해 본인 콘텐츠로 확인한다. request body의 actor/createdBy는 신뢰하지 않는다.

## 삭제와 정산

계정 삭제 marker 생성과 같은 트랜잭션에서, 소유 증거가 현재 값과 일치하는 본인 필드만 비운다. 필수 제목은 `삭제된 내용`으로 바꾼다. 금액, 날짜, 결제자, 분담/송금 관계는 변경하지 않는다. 닫힌 회기의 수입에서도 입증된 제목/메모 삭제만 허용하고 숫자는 잠근다.

콘텐츠 UPDATE는 행을 먼저 잠그므로 삭제의 부모 잠금 순서와 충돌할 수 있다. trigger는 계정 advisory/member 잠금을 비차단으로 확인하고, 삭제가 선점하면 편집에 재시도 오류를 반환한다. 삭제와 편집이 서로 기다리는 deadlock 대신 한쪽을 명확히 중단한다.

새 정산을 만들 때 현재 필드의 소유 증거와 같은 값만 snapshot 소유 증거로 복사한다. 계정 삭제 시 그 복사본만 지우며 계산 JSON은 그대로 둔다. snapshot 생성은 원본 expense를 잠그고 내용을 비교한다. 삭제 전 읽어 둔 오래된 개인정보가 삭제 후 새 정산에 들어오면 저장을 거절한다. 재시도는 새 장부를 읽어야 한다.

사진 경로는 SQL 트랜잭션의 `account_content_cleanup`에 보존한다. 외부 Storage 삭제는 SQL commit 후 수행한다. 전체 queue를 exact count/페이지 단위로 확인하고, 다른 현재 기록이나 snapshot이 경로를 계속 참조하면 삭제하지 않는다. 삭제 응답과 파일 부재를 모두 확인하고 완료를 기록해야 Auth 삭제로 넘어간다. 실패/결과 불명은 완료가 아니며 queue를 남겨 재시도한다. 다른 자료에서 참조하는 파일은 별도 확인 없이 제거하지 않는다.

## 완료됐다고 주장할 수 없는 범위

- 과거 작성자/업로더가 없는 콘텐츠, 여러 사람이 편집한 문장, 오래된 정산의 사본은 역추정하지 않는다.
- `item_lines`의 품목명, 기존 정산의 자유 label, 팀/장부 이름은 이번 최소 변경에서 작성자 추적하지 않는다. 보정/환불 제목은 모바일에서 원문으로 자동 생성하므로 귀속 불명으로 두고 사유만 추적한다. 상속한 판매처/분류/묶음도 원 작성자를 새 기록자로 바꾸지 않는다.
- 일반 지출/팀 삭제의 기존 best-effort 파일 정리는 별도 문제다. 과거 이미 고아가 된 파일의 소유권을 이 migration이 복구하지 않는다.
- 같은 파일을 다른 귀속 불명 기록이 참조하면 `CONTENT_STILL_REFERENCED`로 멈춘다. 운영자가 신원/참조를 확인해야 하며 임의로 queue 완료를 표시하면 안 된다.
- 따라서 ‘모든 개인 콘텐츠 자동 삭제’나 ‘심사 준비 완료’의 근거가 아니다. 추적 가능한 콘텐츠의 삭제 범위를 개선한 후보이며, 나머지 보관/삭제 정책과 사용자 확인 절차는 별도로 정해야 한다.

## 검증

```sh
node checks/account-deletion-pg.mjs
node checks/content-cleanup.mjs
node checks/content-actor.mjs
node checks/account-deletion.mjs
node checks/storage-cross-review.mjs
node checks/image-upload-lifecycle.mjs
npm run typecheck
npm run build
```

- 실제 격리 PostgreSQL 17.6 **35개**: 기존 계정/Apple/Storage 경쟁 28개와 본인/타인/불명/공동 편집 구분, 검증 actor, guest claim, 닫힌 수입, snapshot 숫자 보존/오래된 내용 거절, 완료 업로더/복사 경로 구분, 후속 오류 전체 rollback 및 독립 backend 편집/삭제 교착 방지 7개. 최종 증거 `work/ai-pg-concurrency/account-run-tfNYfs/result.json` 및 파일 SHA-256 목록. 전체 SQL과 팀 삭제 경쟁 7개도 `team-delete-run-pEsfLe`에서 통과했다. 두 로컬 서버는 종료됐다.
- 실제 Storage 정리 소스 + 모의 API **11개**: 105개 페이지 처리, 사용자 필터, 파일 참조/확인 오류, 거짓 삭제 성공, 저장 실패, 잘린 count, 경로 검증, 완료 항목 재시도.
- 실제 서버 action/repo/mapper + 모의 인증/DB **8개**: 단건/일괄 지출, 수입, 편집/이름표/묶음, 보정/환불에서 확인된 pass만 사용하며 request body의 위조 actor 무시.
- 기존 모의 계정 60, Storage 19, 사진 작업 16 및 웹 계정/CAS 회귀 통과. 실제 외부 Storage/Auth/Apple 동작을 검증했다는 뜻은 아니다.
