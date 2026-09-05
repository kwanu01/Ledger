# Ledger 배포 가이드 — v54 → v67

배포되어 있는 것은 **v54**이고, 이 코드는 **v67**입니다. 그 사이 열세 판이
한 번에 올라갑니다. 순서대로만 하면 됩니다.

---

## 0. 먼저 알아 둘 것

**마이그레이션은 순서대로 다 돌려도 안전합니다.** 0012부터 0022까지 전부
`create or replace` · `if not exists` · `drop … if exists` 로 되어 있어서,
이미 돌린 것을 다시 돌려도 아무 일도 일어나지 않습니다. **어느 것까지
돌렸는지 기억할 필요가 없습니다** — 0012부터 차례로 다 돌리세요.

**되돌릴 수 없는 것은 하나뿐입니다.** 0018의 `alter type … add value 'items'`
— PostgreSQL 은 열거형에서 값을 뺄 수 없습니다. 값 하나가 늘 뿐이라 해가
없지만, 되돌리려면 그 열거형을 다시 만들어야 합니다.

**Supabase 프로젝트를 먼저 백업해 두세요.** Dashboard → Database → Backups.
운영 데이터가 이미 들어 있다면 이 단계를 건너뛰지 마세요.

---

## 1. 코드 올리기

zip 을 풀어 `kwanu01/Ledger` 저장소에 덮어씁니다.

```bash
cd <저장소>
# .env.local 은 저장소에 없어야 합니다. 있는지 먼저 확인
git status --porcelain | grep -i env    # 아무것도 안 나와야 정상

git add -A
git commit -m "v67 — 결산 보고서, 말 걸 때, 말 대신 써 주기"
git push
```

Vercel 이 GitHub 에 붙어 있으므로 push 하면 배포가 시작됩니다. **다만
마이그레이션을 먼저 돌리는 편이 안전합니다** — 2번을 먼저 하고 push 하세요.
새 코드가 아직 없는 칸(`item_lines`, `group_name`)을 읽으면 지출 화면이
통째로 오류를 냅니다.

> 순서: **마이그레이션 → push**

`.gitattributes` 가 없으면 CRLF 경고가 계속 납니다. 한 줄짜리 파일을
만들어 두면 사라집니다.
>
> ```
> * text=auto eol=lf
> ```

---

## 2. Supabase 마이그레이션 (0012 → 0022)

> v67 에는 새 마이그레이션이 없습니다. 0022 까지가 전부입니다.

Supabase Dashboard → SQL Editor 에서 **파일 하나씩, 번호 순서대로** 실행합니다.

| 번호 | 무엇을 하는가 | 이번에 새로 만든 것 |
|---|---|---|
| 0012 | 정산에 든 지출도 지울 수 있게 | |
| 0013 | 정산이 끝난 줄에도 이름표(분류·메모)는 고칠 수 있게 | |
| 0014 | 팀 소유자, 소유자의 대신 확인 | |
| 0015 | 송금이 오간 정산에 든 지출도 지울 수 있게 | |
| 0016 | 장부 밖에서 묻는 말의 하루 상한 | |
| 0017 | '미정산 n건'을 제대로 세기 | |
| **0018** | **항목별 청구** — 열거형에 `items` 추가, `item_lines` 칸, 합계 가드 | ← 새것 |
| **0019** | **지출 묶음** — `group_name` 칸 | ← 새것 |
| **0020** | **들어온 돈과 공금** — `incomes` 표, 열거형에 `common`, 장부의 성격 | ← 새것 |
| **0021** | **검사** — `read_amount`(사진에서 읽은 금액), `checked_at`(넘긴 표시) | ← 새것 |
| **0022** | **예산과 경계** — `budget`(비워 두면 장부가 알아냄), `plan`(지금은 전부 pro) | ← 새것 |

### 0018 과 0020 에서 한 번씩 걸릴 수 있습니다

맨 앞 줄이 이것입니다.

```sql
alter type public.allocation_type add value if not exists 'items';   -- 0018
alter type public.allocation_type add value if not exists 'common';  -- 0020
```

PostgreSQL 은 **열거형에 값을 추가한 트랜잭션 안에서 그 값을 쓰지 못합니다.**
파일 전체를 한 번에 붙여 넣었을 때 이 줄 때문에 오류가 나면:

1. 이 한 줄만 먼저 실행 (Run)
2. 나머지 전부를 다시 실행

파일 안의 다른 곳은 전부 `allocation::text = 'items'` 로 비교하도록 써 두어서,
그 두 번이면 통과합니다.

### 다 돌린 뒤 확인

이 쿼리를 실행해서 **열 칸이 전부 `true`** 인지 봅니다.

```sql
select
  (to_regprocedure('public.delete_expense_deep(uuid,uuid)') is not null)
    as "0012 정산된 지출 삭제",
  coalesce((select pg_get_functiondef(p.oid) like '%tg_op%'
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'guard_settled_expense'), false)
    as "0013 이름표 수정",
  (to_regprocedure('public.open_transfers(uuid)') is not null)
    as "0014 소유자·대신확인",
  coalesce((select pg_get_functiondef(p.oid) not like '%v_confirmed%'
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'delete_expense_deep'), false)
    as "0015 확인된 송금분 삭제",
  (to_regclass('public.ai_open_usage') is not null)
    as "0016 밖에서 묻기 상한",
  (to_regprocedure('public.open_expense_count(uuid)') is not null)
    as "0017 미정산 세기",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'expenses'
            and column_name = 'item_lines')
    as "0018 항목별 청구",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'expenses'
            and column_name = 'group_name')
    as "0019 묶음",
  exists (select 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'incomes')
    as "0020 들어온 돈",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'ledgers'
            and column_name = 'fund_source')
    as "0020 장부의 성격",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'expenses'
            and column_name = 'read_amount')
    as "0021 검사",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'ledgers'
            and column_name = 'budget')
    as "0022 예산";
```

`false` 가 하나라도 있으면 그 번호의 파일만 다시 실행하면 됩니다.

---

## 3. 환경 변수 (Vercel)

Vercel → Project → Settings → Environment Variables.
**이번에 반드시 추가해야 하는 것은 없습니다.** 아래는 전부 기본값이 있습니다.

### 이미 있어야 하는 것

| 이름 | 비고 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | **`NEXT_PUBLIC_` 을 절대 붙이지 않습니다** |
| `LEDGER_COOKIE_SECRET` | |
| `ANTHROPIC_API_KEY` | 없으면 AI 기능만 조용히 꺼집니다 |
| `NEXT_PUBLIC_SITE_URL` | `https://teamledger.net` |
| `NEXT_PUBLIC_KAKAO_JS_KEY` · `NEXT_PUBLIC_KAKAO_LOGIN` | |
| `NEXT_PUBLIC_CONTACT_EMAIL` | |
| `NEXT_PUBLIC_ADSENSE_CLIENT` · `NEXT_PUBLIC_ADSENSE_SLOT` | 품목·아카이브 화면에만 |

### 새로 생긴 것 — 넣지 않아도 됩니다

| 이름 | 기본값 | 무엇 |
|---|---|---|
| `LEDGER_AI_ITEM_MODEL` | `claude-sonnet-4-5` | **영수증을 줄 단위로 읽을 때만** 쓰는 모델 |
| `LEDGER_AI_ITEM_TIMEOUT_MS` | `22000` | 그 읽기의 기다림 |
| `LEDGER_AI_JOT_TIMEOUT_MS` | `12000` | '한 줄로 적기' 의 기다림 |

기존 `LEDGER_AI_MODEL`(기본 `claude-haiku-4-5`)은 그대로입니다. 총액 읽기와
수증이 대화는 여전히 Haiku 입니다.

### 값에 관해 — 읽고 정하세요

**줄 단위 읽기만 Sonnet 입니다.** 총액 하나를 읽는 것과 달리, 열두 줄을
읽어 열두 사람에게 나눠 청구하는데 그중 한 줄이 틀리면 아무도 모르고 그대로
정산이 끝납니다. 그래서 이 자리만 큰 모델을 씁니다.

Sonnet 은 Haiku 보다 입력 3배, 출력 3배입니다. 영수증 한 장 읽는 데
대략 **50~150원** 정도로 보시면 됩니다(줄 수에 따라). 실제로 써 보고
Haiku 로도 충분하면 `LEDGER_AI_ITEM_MODEL=claude-haiku-4-5` 로 내리세요 —
그 한 줄만 바꾸면 됩니다.

상한은 그대로입니다. 장부당 월 `LEDGER_AI_MONTHLY_LIMIT`(기본 200)회,
장부 밖 대화는 하루 `LEDGER_AI_OPEN_DAILY_LIMIT`(기본 300)회.
**사진 열 장을 몰아 넣으면 상한도 10회를 씁니다.**

---

## 4. 밀려 있던 것들

이번 배포와 별개로 아직 안 하신 것들입니다.

### 4.1 카카오 도메인 등록 — 안 하면 로그인이 안 됩니다

Kakao Developers → 내 애플리케이션 → 플랫폼 → Web →
**사이트 도메인**에 `https://teamledger.net` 추가.
그다음 **JavaScript 키 → JS SDK 도메인**에도 같은 주소를 등록합니다.

### 4.2 키 교체 — 예전에 화면 캡처에 찍혀 나갔습니다

그 캡처를 받은 사람이 저뿐이라도, 한 번 밖으로 나간 키는 나간 키입니다.

1. **Supabase service_role 키** — Dashboard → Settings → API → Rotate.
   새 값을 Vercel 의 `SUPABASE_SERVICE_ROLE_KEY` 에 넣고 재배포.
2. **Kakao REST API 키 + Client Secret** — Kakao Developers 에서 재발급.

키는 `.env.local` 과 Vercel 에만 넣습니다. 대화창에 붙여넣지 마세요.

### 4.3 도메인 갱신

`teamledger.net` 은 Porkbun 에서 **2027-09-01 만료**입니다. 자동 갱신을
켜 두셨는지 확인해 두세요.

---

## 5. 배포 뒤 손으로 해 보는 점검

Vercel 배포가 끝나면 폰으로 열어서 이 순서대로 해 보세요.
**새 기능은 전부 지출 기입 화면 하나에 모여 있습니다.**

1. **장부 열기** — 기존 지출들이 그대로 보이는가. (0018·0019 가 안 돌았으면
   여기서 바로 오류가 납니다)
2. **사진 한 장** 올리기 → 칸이 채워지고 저장되는가. (예전과 같아야 합니다)
3. **사진 두 장 이상** 한꺼번에 고르기 → 몰아서 적는 화면으로 넘어가고,
   한 장씩 차례로 읽히는가. 훑고 나서 '한꺼번에 적기'.
4. **한 줄로 적기** — "어제 다이소에서 테이프 3천원, 다 같이" 를 넣어 보기.
   금액·날짜·부담 방식이 맞게 들어오는가.
5. **항목별 청구** — 배달 주문 화면을 캡처해 올리고, 부담 방식에서
   '항목별로 나눠 청구' → '영수증에서 항목 읽기'. 줄이 뽑히는가.
   '하나씩' 으로 넘겨 항목마다 사람을 고르고, **합계가 결제 금액과 맞는지**.
6. **묶음** — 지출 하나에 '1차 MT' 같은 이름을 붙이고, 장부 화면에서
   '묶어 보기 → 묶음' 으로 접었다 펴 보기. 소계가 금액 칸 아래 서는가.
7. **같은 판매처로 두 번째 지출** 적어 보기 → 분류 칸 아래에
   "지난 2번 중 2번 …" 제안이 뜨는가.
8. **정산** — 항목별 지출이 든 채로 정산해서 송금 목록이 나오는가.
   **각자 낼 돈의 합이 총액과 정확히 맞는지** 확인.
9. **수증이** 에게 "내가 얼마 내야 해?" 물어보기. 항목별 지출의 줄까지
   알고 답하는가.
10. **기존 장부가 하나도 안 달라졌는지** — 전부 '각자 결제'로 서고
    '들어온 돈' 탭은 안 보여야 정상입니다.
11. **팀 화면 → 장부 성격**을 '회비를 모아서 쓰기'로 바꾸고 1인당 회비를 넣기.
    '들어온 돈' 탭이 서고, 부담 방식에 '공금에서'가 생기는가.
12. **회비 두 줄 + 공금 지출 한 줄**을 적고 결산이 맞는가.
    **공금 지출은 정산에 안 들어가야 합니다** — 집행한 사람에게 받을 돈이
    생기면 그건 버그입니다.

3·5·12 번이 이번 판의 핵심이고, **8번과 12번이 회계가 안 깨졌다는 증거**입니다.

---

## 6. 되돌리기

문제가 생기면 Vercel → Deployments → 직전 배포 → **Promote to Production**.
코드만 되돌아가고 데이터베이스는 그대로입니다.

새 칸(`item_lines`, `group_name`, `fund_source` …)은 **비어 있어도 옛 코드가
무시**하므로,
마이그레이션을 되돌릴 필요는 없습니다. 다만 항목별 청구로 이미 적은
지출이 있다면 옛 코드에서는 그 줄의 부담 방식을 읽지 못합니다 — 되돌리기
전에 그런 줄이 있는지 보세요.

```sql
select
  count(*) filter (where allocation::text = 'items')  as "항목별",
  count(*) filter (where allocation::text = 'common') as "공금"
from public.expenses;
select count(*) from public.incomes;
```

---

## 이번에 올라가는 것 (v55 → v67)

| 판 | 내용 |
|---|---|
| v55 | **항목별 청구** — 부담 방식 네 번째. 영수증 줄마다 부담자가 다를 때. 줄 단위 AI 읽기(Sonnet), 합계 검사 3겹(화면·서버·DB) |
| v56 | **지출 묶음** + 장부 접어 보기(묶음·달·분류·결제자). 정산 후에도 붙일 수 있는 이름표 |
| v57 | 항목 **하나씩 훑기** — 사람 기준을 항목 기준으로 |
| v58 | 상자를 걷어 내고 괘선·단추 언어로 통일 |
| v59 | 문구 정리 — '줄'과 '항목' 어휘 통일, 6개 언어 |
| v60 | **한 줄로 적기** + **장부가 이미 아는 것**(과거에서 분류·부담 제안) |
| v61 | **사진 몰아서 적기** |
| v62 | 서비스 안 **업데이트 내역** 화면 |
| v63 | **수입과 공금** — 수입 항목, 공금 지출, 회비 납부, 결산, 장부 성격, 부르는 이름 |
| v64 | **설정을 걷어 냄** — 수입도 한 줄로 적기(갈래·낸 사람을 글에서 읽음), 1인당 회비를 장부가 알아냄, '회기 이월' 체크칸 삭제 |
| v65 | **검사** — 중복 탐지, 튀는 금액, 영수증과 적힌 값 대조, 빠진 사람. 전부 순수 함수(AI 안 부름), 한 번 답하면 안 묻는다 |
| v66 | **예산과 집행률** — 예산은 들어온 돈에서 알아냄, "이 속도면 8주쯤 더 갑니다". `plan` 칸 하나(아직 안 읽음) |
| v67 | **결산 보고서**(인쇄용, 모델 안 부름) · **말 걸 때**(미룬 것이 쌓였을 때 한 줄) · **말 대신 써 주기**(독촉 문장) |

같이 고친 기존 버그
- 정산이 끝난 지출을 고칠 때 `item_lines` 가 잠기지 않던 것 (0018 에서 함께)
- `EditExpense` 가 항목별 지출을 저장하면 부담 방식이 조용히 개인 귀속으로
  바뀌며 줄이 사라지던 것
- 모바일에서 `.pick-sub input` 규칙이 체크박스가 아닌 글자 칸까지
  18px 네모로 찌그러뜨리던 것

검산 불변식은 **22개 → 125개**로 늘었고 전부 통과합니다 (`npm run simulate`).
