-- ============================================================================
-- Ledger — 0001 Schema
--
-- 결정 사항 반영
--   1. 정산 후 수정 → 원본 불변 + 보정 항목 (adjustment_*)
--   2. 환불        → 음수 금액 지출 (amount < 0 허용)
--   3. 팀원 변동    → 지출마다 기록 시점 명단을 박아둔다 (team_member_ids)
--   4. 부가 금액    → 별도 모델링 없이 amount에 합산
--   5. 참여 방식    → 생성자만 로그인, 팀원은 초대 링크 (members.user_id NULL 허용)
--
-- 금액은 전부 bigint, 원(KRW) 단위 정수. numeric/float를 쓰지 않는다.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── 사용자 ──────────────────────────────────────────────────────────────────
-- Supabase auth.users를 확장. 장부를 만드는 사람만 여기에 생긴다.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at  timestamptz not null default now()
);

-- ── 팀 ──────────────────────────────────────────────────────────────────────
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now()
);

-- 초대 링크. 토큰을 아는 사람이 팀에 들어온다.
-- 링크 유출에 대비해 만료·회수가 가능하도록 별도 테이블로 둔다.
create table public.invites (
  token       uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz
);
create index invites_team_idx on public.invites (team_id);

-- ── 팀원 ────────────────────────────────────────────────────────────────────
-- 로그인한 팀원은 user_id가 채워지고, 초대 링크로 들어온 팀원은 NULL이다.
-- 어느 쪽이든 정산 계산에서는 똑같이 취급한다.
create table public.members (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  user_id      uuid references public.profiles (id) on delete set null,
  display_name text not null,
  -- 이탈한 팀원도 지우지 않는다. 과거 지출의 부담자로 계속 남아야 한다.
  active       boolean not null default true,
  -- 나머지 1원 배분 순서를 결정적으로 만들기 위한 고정 순서
  sort_order   integer not null,
  created_at   timestamptz not null default now(),
  unique (team_id, sort_order)
);
create index members_team_idx on public.members (team_id);

-- ── 장부 ────────────────────────────────────────────────────────────────────
create table public.ledgers (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  name        text not null,
  started_at  date not null default current_date,
  -- 프로젝트 종료 = 아카이브. 장부를 지우는 것이 아니다.
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index ledgers_team_idx on public.ledgers (team_id);

-- ── 지출 ────────────────────────────────────────────────────────────────────
create type public.allocation_type as enum ('all', 'partial', 'personal');
create type public.adjustment_kind as enum ('correction', 'refund');

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  ledger_id    uuid not null references public.ledgers (id) on delete cascade,
  spent_on     date not null,
  title        text not null,
  -- 원 단위 정수. 환불·보정은 음수일 수 있으므로 0만 막는다.
  amount       bigint not null check (amount <> 0),
  payer_member_id uuid not null references public.members (id) on delete restrict,

  -- 기록 시점의 팀원 명단 스냅샷. '전체 팀 공동'의 기준이며 배열 순서가
  -- 나머지 1원 배분 순서를 결정한다. 팀원이 나중에 늘어도 과거 지출은 안 흔들린다.
  team_member_ids uuid[] not null check (array_length(team_member_ids, 1) >= 1),

  allocation   public.allocation_type not null default 'all',
  participant_member_ids uuid[],        -- allocation = 'partial' 일 때만
  owner_member_id uuid references public.members (id) on delete restrict, -- 'personal' 일 때만

  -- 보정·환불. 원본은 절대 고치지 않고 차액만 새 행으로 남긴다.
  adjustment_kind      public.adjustment_kind,
  adjustment_target_id uuid references public.expenses (id) on delete restrict,
  adjustment_reason    text,

  vendor       text,
  category     text,
  product_link text,
  -- Storage 경로. 증빙과 썸네일은 절대 섞지 않는다 (§9).
  receipt_path text,
  representative_image_path text,
  note         text,

  created_at   timestamptz not null default now(),
  created_by_member_id uuid references public.members (id) on delete set null,

  constraint partial_needs_participants check (
    (allocation = 'partial' and coalesce(array_length(participant_member_ids, 1), 0) >= 1)
    or (allocation <> 'partial' and participant_member_ids is null)
  ),
  constraint personal_needs_owner check (
    (allocation = 'personal' and owner_member_id is not null)
    or (allocation <> 'personal' and owner_member_id is null)
  ),
  constraint adjustment_is_complete check (
    (adjustment_kind is null and adjustment_target_id is null)
    or (adjustment_kind is not null and adjustment_target_id is not null)
  ),
  -- 환불은 돌려받은 돈이므로 반드시 음수다.
  constraint refund_is_negative check (
    adjustment_kind is distinct from 'refund' or amount < 0
  ),
  constraint no_self_adjustment check (adjustment_target_id is distinct from id)
);
create index expenses_ledger_date_idx on public.expenses (ledger_id, spent_on, id);
create index expenses_adjustment_target_idx on public.expenses (adjustment_target_id)
  where adjustment_target_id is not null;

-- ── 정산 ────────────────────────────────────────────────────────────────────
-- snapshot은 확정 시점의 계산 결과 전체(잔액·송금·지분)를 그대로 담는다.
-- 이후 엔진이 바뀌거나 지출이 늘어도 이 값은 재계산하지 않는다.
create table public.settlements (
  id          uuid primary key default gen_random_uuid(),
  ledger_id   uuid not null references public.ledgers (id) on delete cascade,
  seq         integer not null,
  settled_on  date not null default current_date,
  label       text not null,
  is_final    boolean not null default false,
  snapshot    jsonb not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  unique (ledger_id, seq)
);

-- 어떤 지출이 어느 정산에 들어갔는지. 한 지출은 한 정산에만 들어간다.
-- 이 unique 제약이 누적 모델의 핵심 불변식(이중 정산 불가)을 DB에서 보장한다.
create table public.settlement_expenses (
  settlement_id uuid not null references public.settlements (id) on delete cascade,
  expense_id    uuid not null references public.expenses (id) on delete restrict,
  primary key (settlement_id, expense_id),
  unique (expense_id)
);

-- ── AI 사용량 계측 ──────────────────────────────────────────────────────────
-- 영수증 분석 1건마다 한 행. 팀당 월 상한을 걸고, 나중에 비용 판단의 근거로 쓴다.
create table public.ai_extractions (
  id            uuid primary key default gen_random_uuid(),
  ledger_id     uuid not null references public.ledgers (id) on delete cascade,
  expense_id    uuid references public.expenses (id) on delete set null,
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  -- 1/1,000,000 USD 단위 정수. 부동소수점으로 돈을 세지 않는다.
  cost_micro_usd bigint not null default 0,
  succeeded     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index ai_extractions_ledger_month_idx
  on public.ai_extractions (ledger_id, created_at);
