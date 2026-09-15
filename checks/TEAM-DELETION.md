# 기존 팀 삭제 · 소유권 경쟁 보완 후보

2026-09-15. 운영에 적용하지 않았다. Storage의 새 계정 삭제 흐름과 별개로, 기존 웹 `deleteTeam`의 지연 요청이 새 소유자 팀을 지울 수 있는 경계를 보완한다.

기존 서버는 소유자를 조회한 뒤 `delete_team(teamId)`를 호출했다. 그 사이 A→B 소유권 이전이 끝나도 A의 삭제가 진행될 수 있었다. 새 서버는 확인한 사용자 ID를 `delete_team_as_owner(teamId, expectedOwnerId)`에 전달한다. 서버가 검증한 pass만 사용자 ID의 출처이며 요청 body의 사용자 필드는 사용하지 않는다.

CLI로 생성한 `20260915064314_authorized_team_deletion.sql`은 계정 삭제 marker 확인 후 팀 행을 `FOR UPDATE`로 잠그고, 현재 owner와 expectedOwner가 같을 때만 같은 트랜잭션에서 기존 삭제를 실행한다. 모든 중간 실패는 롤백한다. wrapper는 서비스 역할만 실행할 수 있고, 기존 원시 `delete_team(uuid)`의 실행 권한은 public/anon/authenticated/**service_role 모두 회수**한다. 원시 함수는 검증된 SECURITY DEFINER wrapper 내부에서만 호출한다. 고정 search_path를 사용하며 서버가 wrapper의 `true`를 확인하지 못하면 실패로 반환한다.

```sh
node checks/team-deletion-action.mjs
node checks/team-deletion-pg.mjs
npm run typecheck
```

- 실제 서버 액션+격리 모의 **9개 통과**. 검증 신원 고정, guest/다른 owner 차단, 확인 불가/오류 시 원시 RPC fallback 금지, 기존 Storage 경계 확인.
- 실제 PostgreSQL **17.6**, 새로운 loopback DB, 전체 **27개 migration**, **7개 통과**. 원시 RPC 서비스 권한까지 거절, wrapper 익명/일반계정 거절, 정상 삭제, 이전 소유자 거절, 삭제/소유권 이전의 양방향 다중 세션 경쟁, 부분 DB 실패 롤백, 계정 삭제 marker 확인.
- 증거: `work/ai-pg-concurrency/team-delete-run-W5vo9s/result.json`, 파일별 SHA-256 `migrations.json`. 임시 서버 종료, 운영 요청 0.
- 서버 typecheck 및 기존 member-revocation 18개·ownership CAS 회귀 통과.

이 변경은 **일반 팀 삭제의 Storage 정리를 완성하지 않는다.** 기존 `deleteTeam`은 DB 삭제 후 사진 정리 실패를 기록하고 성공을 반환하므로 고아 파일 가능성이 남는다. 새 계정 삭제 queue의 보장은 그 별도 경로에만 적용된다. 전체 서비스의 모든 데이터 삭제가 완성됐다고 표현하지 않는다.

새 서버 코드를 배포하려면 이 네 번째 후보 migration까지 함께 검토해야 한다. migration 적용 후 구버전 서버의 원시 RPC는 권한 거절되고, migration 적용 전 새 서버의 wrapper 호출은 미존재로 거절된다. 이 전환을 고려해 팀 삭제 유입을 중지하고 배포 순서를 조율해야 한다. 실제 운영 적용·계정/팀 삭제·Storage 요청은 이 작업에서 실행하지 않았다.
