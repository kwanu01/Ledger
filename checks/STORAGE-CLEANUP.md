# 계정 삭제 시 사진 정리 · 운영 검토 후보

운영 DB/Storage에 적용하거나 실제 계정을 삭제한 기록이 아니다. 이 문서는 실패를 완료로 바꾸지 않고 삭제를 재개하는 절차다.

## 처리 범위

- 삭제되는 개인 소유 장부: 같은 DB 트랜잭션에서 장부 UUID prefix를 `account_image_cleanup`에 보존한다. 100개씩 모든 하위 폴더·파일을 먼저 읽고, 100개씩 제거한 뒤 정상 재목록에서 파일 0개를 확인해야 완료 표시를 기록한다. Auth 삭제는 그 뒤다.
- 유지되는 공동 장부: 새 [소유 추적 후보](CONTENT-OWNERSHIP.md)가 확인한 본인 첨부는 정확한 경로 queue로 삭제한다. 과거/불명 업로더의 사진은 추정 삭제하지 않는다. 사용자가 탈퇴하는 동안 진행 중인 업로드는 user/member에 결합한 `image_upload_operations`로 추적한다. guest 업로드 뒤 계정 claim도 포함한다. 새 파일 연결은 현재 멤버 권한과 이전 사진 경로를 DB에서 다시 확인한다.
- 업로드 응답을 확인했어도 metadata·구파일 정리 또는 보상삭제가 확인되기 전에는 작업을 지우지 않는다. 단일 파일 삭제도 정상 재목록에서 해당 파일의 부재를 확인한다. 일반 사진 제거는 파일 삭제 확인 후 CAS로 참조를 해제한다. 그 사이 권한이 사라지면 삭제 실패가 표시되고, 지워진 파일을 가리키는 참조가 남을 수 있다.

`IMAGE_UPLOAD_PENDING`(409)은 업로드 결과가 아직 확인되지 않았다는 뜻이다. `IMAGE_CLEANUP_FAILED`/`IMAGE_CLEANUP_UNAVAILABLE`(503)은 파일 삭제 또는 목록/결과 기록을 확인하지 못했다는 뜻이다. 모두 Auth 삭제 및 완료 응답을 막는다. 이미 DB 데이터가 삭제되었을 수 있으므로 ‘아무것도 변경되지 않았다’고 안내하면 안 된다.

## 사용자 재시도와 운영자 복구

1. 사용자에게 현재 로그인 상태에서 계정 삭제를 다시 시도하도록 안내한다. 정상 진행 요청이 끝나면 operation이 없어지고 다음 시도에서 남은 prefix만 처리한다. Auth 삭제 실패도 같은 흐름으로 재시도한다. 그동안 삭제 marker는 프로필/권한 재생성을 막는다.
2. 동일한 409가 계속되면 운영자가 사용자 동의·신원 확인 후 해당 user의 operation과 queue를 서비스 권한으로 점검한다. 일반 클라이언트에는 이 표와 RPC 접근 권한이 없다. 로그에 실제 영수증이나 전체 사용자 식별자를 공개하지 않는다.
3. operation은 자동 만료시키지 않는다. Storage 요청을 보낸 서버 실행이 확실히 종료되었고 새 파일이 늦게 만들어질 수 없음을 먼저 확인한다. 단순히 몇 분 지났다는 이유로 row를 지우면 안 된다. 원격 응답이 불확실하면 작업을 유지하고 복구를 계속한다.
4. 삭제할 장부 prefix라면 Storage API로 operation의 정확한 경로를 제거하고, 정상 전체 목록에서 부재를 확인한다. 유지되는 공동 장부라면 현재 expense의 정확한 사진 참조를 먼저 확인한다. 참조되지 않는 파일만 제거한다. 새 파일이 정당하게 연결되어 있고 구파일 정리도 확인되었다면 공동 기록 보관 대상으로 작업을 마칠 수 있다. 과거 구파일 경로를 확인할 수 없으면 임의로 완료 처리하지 말고 별도 조사를 한다.
5. 위 확인 후에만 서비스 권한 `finish_image_upload(operation UUID, object_path)`로 해당 작업을 마친다. 사용자 계정 삭제 흐름을 재실행하여 queue 정리·부재 확인·Auth 삭제까지 수행한다. `completed_at`이나 Auth를 수동으로 먼저 지워 장애를 숨기지 않는다.

Storage 객체는 Storage API로 삭제한다. `storage.objects`를 SQL로 지우면 실제 파일이 남을 수 있다. [Supabase 삭제 안내](https://supabase.com/docs/guides/storage/management/delete-objects)는 1회 1,000개 제한과 API 삭제를 명시한다. 구현은 그보다 작은 100개 묶음을 사용한다. 목록은 [공식 list API](https://supabase.com/docs/reference/javascript/file-buckets-list)의 offset/limit/name 순서를 사용한다.

## 적용 전 확인

1. 업로드와 계정 삭제 유입을 일시 중지하고 구버전 요청의 종료를 확인한다. 새 migration은 이미 진행된 구버전 업로드를 소급 등록하지 못한다. 기존 고아 파일은 별도 근거로 점검한다.
2. 세 후보 migration을 순서대로 적용한 뒤 서버를 배포한다. `account_image_cleanup_ready`가 false이면 계정 삭제는 첫 변경 전에 거절된다. 구버전 앱의 이미지 서버 액션도 신규 서버를 사용해야 한다.
3. 격리 검증 결과와 실제 Supabase 설정을 비교한 후, 별도 테스트 계정으로 사진 추가·교체·삭제·계정 삭제·Storage 장애 복구를 확인한다. 실계정/실제 영수증을 검증 재료로 삼지 않는다.

이 검증에는 실제 Supabase Storage 장애/지연/백업/버전 보관이나 실제 iPhone QA가 포함되지 않는다. 일반 팀 삭제의 기존 best-effort 파일 정리, 과거 고아 파일, 공유 자유 입력에 남은 개인정보, 백업·로그 보관 정책은 이 후보가 모두 해결했다는 뜻이 아니다. 네트워크 장애가 계속되거나 미확인 업로드의 실행 종료를 입증할 수 없으면 자동 완료 대신 운영자 복구가 필요하다.

로컬 검사: `node checks/account-deletion-pg.mjs`(실제 PG17.6 다중 세션), `node checks/image-upload-lifecycle.mjs`, `node checks/storage-cross-review.mjs`, `node checks/account-deletion.mjs`. Storage/Apple/Auth 요청은 전부 모의이며 실제 계정/파일 삭제 0건이다.
