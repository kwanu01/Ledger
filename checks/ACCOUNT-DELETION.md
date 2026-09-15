# 계정 삭제 후보 · 2026-09-15

**로컬 구현·격리 검증 완료. 운영 migration·배포·실제 계정 삭제는 하지 않았다.**

## 변경 계약

`wipeAccount(verifiedUserId)`는 기존 `{ok:false, blocked}` 또는 `{ok:true, removedBooks}`에 성공 시 `appleCleanup: 'not_required' | 'revoked' | 'manual_required'`를 더한다. userId는 웹/모바일의 서버 검증 신원에서 받아야 한다. Apple 수동 해제가 남으면 ‘전부 해제 완료’로 표현하지 않는다.

웹 `withdraw(expectedUserId)`는 화면에서 확인한 UUID와 서버가 검증한 현재 계정이 정확히 일치할 때만 삭제한다. 다른 탭의 계정 전환 후 이전 화면에서 누른 삭제는 거절한다. 소유권 이전은 검증된 현재 사용자 ID를 UPDATE의 기존 owner_id 조건에 포함하고, 실제 변경 행이 없으면 실패한다. 늦은 이전 요청이 새 소유자를 덮어쓸 수 없다.

순서: 전체 계정 사실 검증 → 공유 장부 소유 시 중단 → 사진 정리 schema 준비 확인 → Apple 권한 해제 → `wipe_account_data` DB 트랜잭션 → 사진 정리 및 부재 확인 → Auth 계정 삭제. 조회 오류·null count·잘린 결과·RPC/Storage/응답 오류·Auth 오류를 성공으로 반환하지 않는다. DB RPC는 잠금 후 소유권과 활성 계정 팀원 수를 다시 검사한다. 기존 소유권 정책(다른 활성 연결 계정이 있으면 먼저 양도)은 유지한다.

삭제할 장부 prefix는 DB 트랜잭션의 `account_image_cleanup`에 남는다. Storage 실패 때 Auth와 이 목록을 유지하여 재시도한다. `image_upload_operations`는 업로드 시작부터 metadata CAS 연결·구파일 삭제 확인, 또는 보상삭제 확인까지 유지된다. 탈퇴자의 공유 장부 업로드도 추적하며 guest→계정 claim 때 진행 작업을 새 계정에 귀속시킨다. 미확인 업로드에는 자동 만료를 두지 않는다. 이 경우 `IMAGE_UPLOAD_PENDING`(409)으로 재시도/문의 안내를 반환하며 완료로 표시하지 않는다. [복구 절차](STORAGE-CLEANUP.md)를 참고한다.

`members.account_deleted_at`은 영구 회수 상태다. 이름은 **탈퇴한 팀원**, 은행·계좌·user_id는 NULL, active는 false로 바꾼다. DB trigger가 재활성화·기존 행 재claim·개인정보 복원·timestamp 제거·식별자 이동·개별 행 삭제를 거절한다. 팀 전체가 삭제되는 cascade는 허용한다. `joinTeam`, `claimMembership`, 웹/모바일 공용 접근 검사도 상태를 확인하며, 열이나 조회 결과가 없으면 권한을 열지 않는다. 유효한 초대를 통한 새 계정의 새 팀원 행 생성은 허용되지만 과거 팀원 식별자는 가져가지 않는다.

Auth 요청이 실패해도 옛 UUID로 프로필을 재생성하지 못하도록 `account_deletions`를 둔다. 이 표는 서버만 읽고 쓰며 `auth.users` FK cascade로 **Auth 삭제 성공 때 제거**된다. 이후 같은 UUID profile 생성은 원래 Auth FK가 거절한다. 영구 보관되는 것은 공동 회계 기록에 필요한 멤버 식별자와 탈퇴 시각이다.

## 검증

```sh
node checks/account-deletion.mjs
node checks/member-revocation.mjs
node checks/account-return.mjs
node checks/account-binding.mjs
node checks/ownership-cas.mjs
node checks/mobile-account.mjs
node --conditions=react-server --experimental-strip-types --test scripts/mobile-api-test.ts
node checks/account-deletion-pg.mjs
node checks/image-upload-lifecycle.mjs
node checks/storage-cross-review.mjs
npm run typecheck
```

- 실제 계정/액션/access 소스 + DB/Auth/Apple/Storage 모의: **60개**. 정확한 전체 조회, 실패 후 다음 단계 중단, 실제 서명 쿠키의 과거 부활 control과 새 영구 회수, Apple 결과 전달, 누락/잘못된 UUID 및 화면과 다른 계정의 삭제 거절. Storage 미준비는 첫 변경 전 중단, Storage 오류는 Auth 삭제 전 중단한다.
- 실제 웹 화면/서버 액션 연결: A 화면/B 쿠키에서 삭제 0, 일치한 계정만 삭제, unmount 뒤 늦은 응답 무시, 서버 페이지의 ID/키 결합. 실제 repository/팀 액션 모의 경쟁: A→B 성공 뒤 오래된 A→C 거절, 실패/누락/탈퇴한 대상/게스트·위조 확인값 거절. 새 모바일 계정 route **19개**도 통과.
- 실제 팀 액션 + 모의 DB: **18개**. 초대/자동 claim/재활성화, 오류·누락 필드, conditional update 경쟁, 실패 시 쿠키 미발급.
- 기존 모바일 계약 **13개**, 로그인 복귀 경로 검사, TypeScript 검사 통과.
- 실제 **PostgreSQL 17.6**, 127.0.0.1의 임시 고포트, 완전 신규 DB: **28개**. 원본 migration과 세 새 migration 전부 적용, anon/authenticated 권한 거절, shared expense/snapshot/transfer/income 전후 동일, 이름·은행·계좌 삭제, DB 8개 삭제 단계 각각 실패 시 queue까지 전부 롤백, Auth cascade, 재활성화/프로필 재생성 거절. 독립 세션으로 팀원 활성화·소유권 이전·프로필 재생성 및 Apple reserve/complete와 삭제 경쟁을 확인했다. 업로드 예약/삭제 경쟁, 공유 장부 탈퇴 후 metadata 연결 차단, guest claim 귀속, stale 교체/삭제 CAS와 미확인 작업 보존도 검증했다.
- 실제 사진 저장소/서버 액션 소스 + 모의 Storage/DB: **16개**. actor와 expected-path 전달, 업로드 오류·metadata 실패·보상삭제 실패·구파일 잔존·재목록 실패 때 reservation 유지, 삭제 확인 뒤 metadata 해제. 별도 `storage-cross-review.mjs`는 전체 페이지, 부분 실패 재시도, 잘린 queue, 완료 후 재호출 등을 독립 검증한다. 네트워크 요청은 없다.

PG 검사에는 로컬에서 만든 최소 `auth.users`, `auth.uid()`, `storage.buckets` fixture가 쓰인다. 실제 Supabase Auth/Storage 서비스나 Apple 네트워크를 검증한 것은 아니다. 바이너리/pg 라이브러리는 `../ai-pg-concurrency/node_modules`의 기존 검증 도구만 사용한다. 원격 연결 설정은 읽거나 받지 않는다. 완료 뒤 임시 PG를 중지한다.

PG 증거: `../../ai-pg-concurrency/account-run-V0yCsT/result.json`, 같은 폴더 `migrations.json`의 파일별 SHA-256. broad default privileges가 있어도 service_role에는 marker의 SELECT/INSERT만 남는 것을 포함한다. 테스트 실행 시 새로운 `account-run-*` 폴더를 만든다.

## 적용 순서와 남은 경계

1. root 리뷰 후 migration `20260915055134_permanent_account_access_revocation.sql`, `20260915055506_apple_authorization_lifecycle.sql`, `20260915062212_account_image_cleanup_queue.sql` 순서를 검토한다. 현재 파일은 Supabase CLI `migration new`로 생성한 후보이며 아직 운영에 적용하지 않았다. 배포 전부터 실행 중인 구버전 업로드는 소급 추적하지 못한다. 업로드/삭제를 잠시 중지하고 구버전 요청 종료와 기존 고아 파일을 확인하는 전환 절차가 필요하다.
2. 서버 변경은 migration 뒤에 배포한다. 열/RPC 미존재 시 접속·가입·삭제가 fail closed이므로 코드를 먼저 배포하면 기존 흐름도 거절된다. 이전 서버 코드로 되돌려도 DB tombstone trigger는 계속 접근 복원을 차단한다.
3. Apple·Auth·Storage 외부 작업은 DB 트랜잭션과 원자적이지 않다. Apple 권한 해제 뒤 소유권 경쟁으로 DB가 삭제를 거절할 수 있다. 기존 세션에서 소유권을 정리하고 재시도할 수 있지만 이미 해제된 Apple 권한은 롤백하지 않는다. Apple freeze 해제/삭제 취소 복구 정책과 운영자 복구 절차는 별도 검토 대상이다.
4. 공동 장부의 지출 제목·자유 입력 메모·영수증·과거 snapshot에 포함된 자유 입력 내용은 유지된다. 그 안의 개인정보를 전부 탐지·제거했다는 뜻이 아니다. 구조화된 멤버 이름/계좌를 제거하고 금액·분담·송금 관계는 유지한다. 첨부/백업/로그 보관 정책, Apple 실계정 연동 및 실제 iPhone QA는 별도 작업이다.
5. 과거 profile 삭제 후 이미 user_id=NULL이 된 행은 일반 게스트와 구별할 근거가 없다. 이번 migration은 이를 추정해서 일괄 삭제/익명화하지 않는다. 과거 삭제 이력이 있다면 별도 근거 기반 정리가 필요하다.

앱의 기존 웹 삭제 진입 `/account?intent=delete#delete-account`는 로그인 후 `/account#delete-account`로 복귀한다. 일반 계정 진입과 알 수 없는 intent는 `/account`로 돌아간다. 새 모바일 삭제 UI/API의 계정 결합·재인증은 별도 모의 검사가 담당한다.
