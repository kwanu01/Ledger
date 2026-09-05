-- ============================================================================
-- Ledger — 0019 지출 묶음 (§11.3)
--
-- 한 장부 안에서도 지출은 덩어리로 생긴다. '1차 MT', '중간발표', '전시 준비'
-- 처럼. 지금까지 장부는 그것을 날짜로만 알 수 있었는데, 날짜는 덩어리의
-- 경계와 잘 맞지 않는다 — 전시 준비물은 3주에 걸쳐 사고, 같은 날 MT 장보기와
-- 출력비가 함께 찍힌다.
--
-- ── 왜 표가 아니라 칸 하나인가
--
-- 묶음을 별도 테이블로 둘 수도 있었다. 그러면 이름을 고치고 지우는 일이
-- 깔끔해지고, 순서도 매길 수 있다. 그런데 **묶음은 계산에 한 푼도 들어가지
-- 않는다.** 지분을 나누지도, 잔액을 움직이지도, 정산의 단위를 바꾸지도
-- 않는다. 그것은 이름표다 — 이 장부에서 vendor 와 category 가 그런 것처럼.
--
-- 계산에 들어가지 않는 것에 외래 키와 조인을 붙이면, 장부를 읽는 모든 자리가
-- 조금씩 무거워지고 정산 엔진이 DB 를 조금 더 알게 된다. 그 값을 치를 이유가
-- 없다. 이름을 바꾸는 일은 같은 이름을 가진 줄들을 한 번에 고치면 되고
-- (repo.renameGroup), 지우는 일은 이름을 비우면 된다.
--
-- 묶음 단위 정산도 이대로 된다. 정산은 이미 지출을 골라서 할 수 있으므로
-- (§15), 묶음은 그 고르는 일의 기준이 하나 더 생긴 것뿐이다.
--
-- ── 정산이 끝난 뒤에도 붙일 수 있다
--
-- 0013 의 가드는 **금액에 닿는 칸**만 잠근다. group_name 은 거기 없으므로
-- 자동으로 이름표 쪽에 선다. 그것이 맞다 — 한 학기가 끝나고 아카이브를
-- 훑으면서 "이건 다 MT 때 거였네" 하고 묶는 순간이 오히려 자연스럽다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.
-- ============================================================================

alter table public.expenses
  add column if not exists group_name text;

comment on column public.expenses.group_name is
  '지출 묶음 이름 (1차 MT, 중간발표 …). 계산에 들어가지 않는 이름표다. 없으면 null.';

-- 빈 문자열은 null 과 같은 뜻인데 화면에서는 다르게 보인다. 한 가지로 모은다.
alter table public.expenses drop constraint if exists group_name_not_blank;
alter table public.expenses add constraint group_name_not_blank check (
  group_name is null or btrim(group_name) <> ''
);

-- 장부 하나를 통째로 읽어 묶음별로 접는 화면이 이 색인을 쓴다.
create index if not exists expenses_ledger_group_idx
  on public.expenses (ledger_id, group_name)
  where group_name is not null;
