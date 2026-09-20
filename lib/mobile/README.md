# teamLedger 앱 API v1

서버 실행 환경은 Node.js다. 기존 웹 액션·도메인·DB 가드를 사용하며, 앱의 Supabase 접근은 인증에만 쓴다. 운영 배포나 마이그레이션 적용은 이 구현에 포함하지 않았다.

## 인증과 응답

`GET /api/mobile/v1/config`만 공개한다. 응답은 `{ok:true,version:1,auth:{url,anonKey}}`이며 공개 URL과 anon/publishable 키만 포함한다. 잘못 설정한 service-role 키는 노출하지 않는다. HTTPS를 사용하며 개발 중 localhost HTTP만 예외다.

다른 요청에는 `Authorization: Bearer <Supabase access_token>`이 필요하다. 서버는 `getUser(token)`으로 검증하고 현재 팀원·소유자 권한을 다시 확인한다. 쿠키만 있는 요청이나 잘못된 Bearer를 쿠키로 우회하지 않는다. 익명 통행증은 해당 DB 멤버가 아직 계정에 귀속되지 않은 경우에만 웹에서 유효하다.

오류는 `{ok:false,code,message}`와 HTTP 상태로 반환한다. 인증 실패 401, 접근 거부 403, 잘못된 입력 400, 충돌 409, 본문 초과 413, 기존 액션 거부 422, 환경 미설정 503을 구분한다. 예기치 않은 서버 오류 내용은 응답에 노출하지 않는다. 모든 응답은 `private, no-store`다.

CORS는 현재 서버 origin, localhost:8088, `NEXT_PUBLIC_SITE_URL`, 쉼표로 구분한 `MOBILE_ALLOWED_ORIGINS`에 한정한다. `OPTIONS`는 인증 없이 통과하지만 허용 origin 검사는 유지한다. 자격 증명 wildcard나 cross-origin 쿠키를 사용하지 않는다.

## 조회

- `GET /api/mobile/v1/bootstrap`: `{ok:true,version:1,user,ledgers,capabilities}`. 장부 항목은 `{id,title,teamId,teamName,currency,archivedAt,isOwner}`다. 비활성 팀원은 소유자 예외를 제외하고 목록에서도 제외한다. `capabilities.ai`는 AI 키와 사용량 예약 RPC 준비 여부를 함께 확인한다.
- `GET /api/mobile/v1/ledgers/:ledgerId`: `{ok:true,ledger,memberId,isOwner,transferStatuses}`. `ledger`는 기존 도메인 `Ledger` 형식이다.
- `transferStatuses`는 `JSON.stringify([settlementId,fromMemberId,toMemberId])` 키를 사용한다. 값은 `{id,settlementId,fromMemberId,toMemberId,sentAt?,receivedAt?,sentByMemberId?,receivedByMemberId?}`다. 수신자는 보냄 표시 없이도 확인할 수 있으므로 `receivedAt`만 있는 상태도 유효하다.
- 멤버·장부 목록·송금 조회는 exact count를 확인한다. 서버 반환 상한으로 결과가 잘리면 부분 결과를 정상 장부로 반환하지 않는다.

## 회계 작업

`POST /api/mobile/v1/ledgers/:ledgerId/actions`에 JSON `{action,input}`을 보낸다. `input.ledgerId`, 행위자 ID, 소유자 플래그는 받지 않는다. 성공은 기존 액션의 `{ok:true,value?}`이며 새 상태는 GET으로 읽는다. JSON 전체 본문은 64KiB 이하다.

| action | input |
| --- | --- |
| `recordExpense` | `clientId?`, `date`, `title`, 양수 정수 `amount`, `payerId`, 도메인 `allocation`, 선택 `vendor/category/group/note/readAmount` |
| `recordIncome` | `date`, `title`, 양수 정수 `amount`, `kind`, 선택 `memberId/note` |
| `setLedgerSettings` | `fundSource`, 선택 `duesPerHead/budget`; 생략 또는 null은 해당 값 제거. 현재 `termCarry`는 보존 |
| `setBookKind` | `fundSource`, `termCarry`, 선택 `duesPerHead` |
| `setBudget` | 선택 `budget`; 생략 또는 null이면 제거 |
| `closeTerm` | `closed:boolean` |
| `settle` | 선택 `expenseIds/label/isFinal`; expenseIds 생략 시 미정산 전체, 빈 배열은 거부 |
| `markTransferSent` | `transferId`, 선택 `undo:boolean` |
| `markTransferReceived` | `transferId`, 선택 `onBehalf:boolean`; 수신 확인 취소는 지원하지 않음 |
| `markChecked` | `expenseId`, `checked:boolean` |
| `addAdjustment` | `targetExpenseId`, signed 정수 `amount`, `kind:refund|correction`, `date`, 선택 `reason` |

설정 세 칸은 검증 후 한 번의 UPDATE로 저장한다. 환불 amount는 음수다. 원본 금액·결제자·제목·배분 구조는 서버에서 읽고, 기존 환불·보정 액션으로 기록한다. 공금 지출은 각자 결제 장부에 새로 기록할 수 없다.

보냄 표시는 송금자만, 수신 확인은 수신자 또는 `onBehalf:true`를 지정한 소유자만 가능하다. 실제 송금을 실행하는 API는 없다. 지출 삭제·정산 취소·팀 삭제는 이번 allowlist에 포함하지 않는다.

앱 지출에는 안정적인 `clientId`를 보내야 한다. 서버는 검증된 계정·장부·clientId에서 결정적인 UUID를 생성한다. 동시 요청과 통신 재시도는 기존 payload가 일치할 때만 같은 id로 성공한다. 같은 clientId로 내용을 변경하면 거부한다. 이 보장은 지출 등록에만 적용되며 다른 쓰기 요청은 자동 재시도하지 않는다. 기존 로컬 데이터·송금 체크를 서버 데이터로 자동 승격하지 않는다.

## AI

`POST /api/mobile/v1/ledgers/:ledgerId/ai`는 JSON `{action,input}` 또는 multipart를 받는다.

- `askHelper`: `{question,history?:[{role:user|assistant,text}]}`. 질문 500자, 최근 대화 6개·각 1,000자. 성공 응답은 `{ok:true,answer,usage}`.
- `jotExpense`, `jotIncomeLine`: `{text}`. 최대 3,000자. 기존 액션의 `value`와 누락 필드를 반환한다.
- `askToPay`: `{toMemberId,why:transfer|dues,warm:boolean,lang}`. 금액은 서버 장부에서 계산한다. 메시지를 보내지 않고 문안만 반환한다.
- multipart `action=analyzeReceipt` 또는 `analyzeReceiptLines`, `image=File`. 요청 전체 4MiB 이하. 장부 ID는 URL에서 설정한다. AI 결과는 저장하지 않으며 확인 후 별도 지출 등록이 필요하다.

AI 키, 사용량 예약 RPC 및 해당 마이그레이션이 준비되어야 한다. 예약 실패 시 모델을 호출하지 않는 기존 AI 액션 규칙을 따른다.

## 검증

```sh
npm run typecheck
node --experimental-strip-types --test scripts/mobile-api-test.ts
node scripts/mobile-route-test.mjs
```

첫 테스트는 인증 fallback·권한·입력·본문 제한·지출 멱등성을 확인한다. 두 번째는 실제 Next 서버와 폐기 가능한 로컬 Auth/DB fixture로 401·403·503·CORS를 확인한다. 실제 운영 계정이나 장부를 사용하지 않는다. UI 검증용 fixture는 작업 디렉터리의 `work/mobile-e2e-fixture.mjs`에 별도로 있으며 DB 트리거의 대체 검증 수단이 아니다.
