-- ============================================================================
-- Ledger — 0020 들어온 돈, 그리고 공금 (§12)
--
-- 지금까지 이 장부는 **나간 것만** 적었다. 팀플에서는 들어오는 돈이 없어서
-- 안 보였을 뿐이고, 그 경계를 넘는 순간 제일 먼저 걸린다. 동아리는 회비를
-- 걷고, 학회는 지원금을 받고, 소모임에는 이월금이 있다.
--
-- 장부는 들어온 것과 나간 것이 둘 다 있고 잔고가 나오는 것이다.
--
-- ── 정산과 결산은 다른 계산이다
--
-- 이 파일에서 제일 중요한 결정이다.
--
--   정산  사람 사이의 채권 관계. "각자 낸 것 − 각자 부담할 것 = 잔액"
--   결산  한 주머니의 잔고.     "이월금 + 수입 − 공금 지출 = 남은 돈"
--
-- 둘을 같은 엔진에 밀어 넣지 않는다. 정산 엔진 위에는 검산 불변식 쉰 개가
-- 서 있고, 그 전부가 "지분의 합 = 금액"을 전제한다. 공금 지출은 아무에게도
-- 나뉘지 않으므로 그 전제가 성립하지 않는다. 억지로 한 엔진에 넣으면
-- 불변식을 느슨하게 풀어야 하고, 그러면 지금 맞는 것들까지 못 믿게 된다.
--
-- 그래서 **공금 지출은 정산에서 통째로 빠진다.** 결제자도, 부담자도 잔액을
-- 움직이지 않는다. 대신 결산에만 들어간다.
--
-- ── 회비 납부는 칸이 아니라 기록이다
--
-- members 에 '냈다/안 냈다' 칸을 두지 않는다. 실제로 알고 싶은 것은 언제
-- 얼마를 냈느냐고, 그건 참/거짓이 아니라 **줄**이다. 그래서 회비도 수입의
-- 한 갈래로 들어가고, 낸 사람이 member_id 로 붙는다.
-- 미납자는 "회비 대상인데 그 줄이 없는 사람"으로 세면 된다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.
-- 맨 앞의 ALTER TYPE 이 트랜잭션 문제로 걸리면 그 한 줄만 먼저 실행하고
-- 나머지를 이어서 실행한다 (0018 과 같다).
-- ============================================================================

-- ── 1. 공금에서 나가는 지출 ─────────────────────────────────────────────────
alter type public.allocation_type add value if not exists 'common';

-- 아래에서 열거형 리터럴을 직접 쓰지 않고 allocation::text 로 비교하는 이유가
-- 이것이다. 같은 트랜잭션 안에서는 방금 추가한 값을 리터럴로 쓸 수 없다.

-- 공금 지출은 부담자를 고르지 않는다. participant_member_ids 도 owner 도
-- item_lines 도 비어야 한다 — 기존 제약이 이미 그렇게 되어 있으므로 손댈 것이 없다.

-- ── 2. 장부의 성격 ──────────────────────────────────────────────────────────
--
-- 축을 넷으로 적어 두었지만(확장 설계 §02), 이번에 만드는 것은 **실제로
-- 화면이 달라지는 둘**뿐이다. 고르는 순간 아무것도 안 달라지는 값을 저장해
-- 두면 그건 장식이고, 장식은 나중에 진짜 기능을 넣을 때 걸림돌이 된다.
--
--   fund_source  돈이 어디서 오는가 — 이것 하나로 수입·결산·공금 부담이 켜진다
--   term_carry   회기를 끊고 남은 돈을 넘기는가
--
-- 나머지 둘(적을 권한, 나누는 방식)은 그 기능을 만들 때 칸을 추가한다.
create type public.fund_source as enum ('each', 'dues', 'grant');

alter table public.ledgers
  add column if not exists fund_source public.fund_source not null default 'each',
  -- 회기를 닫을 때 남은 돈을 다음 회기로 넘기는가
  add column if not exists term_carry boolean not null default false,
  -- 1인당 회비. 미납자를 세는 기준이라 여기 둔다. 없으면 안 센다.
  add column if not exists dues_per_head bigint check (dues_per_head is null or dues_per_head > 0);

comment on column public.ledgers.fund_source is
  'each=각자 결제하고 나중에 나눔(기본) · dues=회비를 모아서 씀 · grant=밖에서 받은 예산';

-- 각자 결제하는 장부에는 회비 기준이 있을 수 없다.
alter table public.ledgers drop constraint if exists dues_needs_fund;
alter table public.ledgers add constraint dues_needs_fund check (
  dues_per_head is null or fund_source::text <> 'each'
);

-- ── 3. 들어온 돈 ────────────────────────────────────────────────────────────
create type public.income_kind as enum ('dues', 'grant', 'donation', 'carryover');

create table if not exists public.incomes (
  id          uuid primary key default gen_random_uuid(),
  ledger_id   uuid not null references public.ledgers (id) on delete cascade,
  received_on date not null,
  title       text not null,
  -- 지출과 같은 규칙. 최소 단위 정수, 0은 막는다.
  -- 잘못 걷은 회비를 돌려주는 일이 있으므로 음수를 허용한다(환불과 같은 이치).
  amount      bigint not null check (amount <> 0),
  kind        public.income_kind not null,

  -- 회비일 때 낸 사람. 다른 갈래에서는 비어 있다.
  -- 팀을 옮기거나 나가도 낸 기록은 남아야 하므로 set null 이 아니라 restrict.
  member_id   uuid references public.members (id) on delete restrict,

  note        text,
  created_at  timestamptz not null default now(),
  created_by_member_id uuid references public.members (id) on delete set null,

  -- 회비는 누가 냈는지가 곧 그 줄의 뜻이다. 없으면 미납을 셀 수 없다.
  constraint dues_needs_member check (
    (kind = 'dues' and member_id is not null)
    or (kind <> 'dues' and member_id is null)
  ),
  -- 이월금은 회기의 시작 잔고다. 한 장부에 여러 번 있을 이유가 없다.
  -- (부분 유일 색인으로 아래에서 막는다)
  constraint carryover_is_positive check (
    kind <> 'carryover' or amount > 0
  )
);
create index if not exists incomes_ledger_date_idx
  on public.incomes (ledger_id, received_on, id);
create unique index if not exists incomes_one_carryover
  on public.incomes (ledger_id) where kind = 'carryover';

-- ── 4. 들어온 돈도 이 장부의 사람만 만진다 ──────────────────────────────────
-- service_role 로 도는 서버가 권한을 확인하지만(lib/access.ts), 그 코드가
-- 틀려도 남의 장부가 열리지 않게 여기서도 막는다. 지출과 같은 방식이다.
alter table public.incomes enable row level security;
alter table public.incomes force row level security;

-- 회비를 낸 사람은 그 장부의 팀원이어야 한다.
create or replace function public.guard_income_member()
returns trigger language plpgsql as $$
declare v_team uuid;
begin
  if new.member_id is null then return new; end if;

  select t.id into v_team
    from public.ledgers l join public.teams t on t.id = l.team_id
   where l.id = new.ledger_id;

  if not exists (select 1 from public.members m
                  where m.id = new.member_id and m.team_id = v_team) then
    raise exception '회비를 낸 사람은 이 장부의 팀원이어야 합니다.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists incomes_member_in_team on public.incomes;
create trigger incomes_member_in_team
  before insert or update on public.incomes
  for each row execute function public.guard_income_member();

-- ── 5. 결산에 들어간 줄은 잠근다 ────────────────────────────────────────────
-- 지출에 걸린 규칙과 같다(0002, 0013). 닫힌 회기의 숫자는 바뀌지 않는다.
alter table public.ledgers
  add column if not exists closed_at timestamptz;

comment on column public.ledgers.closed_at is
  '회기를 닫은 시각. 닫힌 뒤에는 수입을 넣거나 고칠 수 없다.';

create or replace function public.guard_closed_income()
returns trigger language plpgsql as $$
declare v_closed timestamptz;
begin
  select closed_at into v_closed
    from public.ledgers where id = coalesce(new.ledger_id, old.ledger_id);
  if v_closed is not null then
    raise exception '이미 닫힌 회기의 수입은 바꿀 수 없습니다. 회기를 다시 열어 주세요.'
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists incomes_no_change_after_close on public.incomes;
create trigger incomes_no_change_after_close
  before insert or update or delete on public.incomes
  for each row execute function public.guard_closed_income();
