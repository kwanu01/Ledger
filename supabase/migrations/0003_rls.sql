-- ============================================================================
-- Ledger — 0003 Row Level Security
--
-- 접근 모델: 장부 생성자만 로그인하고, 팀원은 초대 링크로 들어온다.
-- 그래서 "로그인한 사용자"만으로는 권한을 표현할 수 없다.
--
-- 선택한 방식: **브라우저에서 DB로 직접 붙지 않는다.**
--   브라우저 → Next.js 서버 액션 → (service_role) → Postgres
--   서버 액션이 세션 쿠키 또는 초대 토큰을 검증한 뒤에만 쿼리한다.
--
-- 따라서 anon / authenticated 역할에는 정책을 하나도 주지 않는다.
-- RLS를 켜고 정책을 비워두면 해당 역할은 어떤 행도 볼 수 없다 (기본 거부).
-- 영리한 RLS 정책으로 토큰 접근을 표현하는 것보다, 검증 지점을 한 곳에
-- 모으는 편이 이 규모에서는 훨씬 안전하고 읽기 쉽다.
--
-- 주의: service_role 키는 절대 클라이언트 번들에 들어가면 안 된다.
--       서버 전용 환경변수로만 쓴다.
-- ============================================================================

alter table public.profiles            enable row level security;
alter table public.teams               enable row level security;
alter table public.invites             enable row level security;
alter table public.members             enable row level security;
alter table public.ledgers             enable row level security;
alter table public.expenses            enable row level security;
alter table public.settlements         enable row level security;
alter table public.settlement_expenses enable row level security;
alter table public.ai_extractions      enable row level security;

-- 뒤에서 정책이 실수로 추가되더라도 기본이 거부로 남도록 강제한다.
alter table public.expenses            force row level security;
alter table public.settlements         force row level security;
alter table public.settlement_expenses force row level security;

-- 유일한 예외: 로그인한 사용자가 자기 프로필을 읽고 고치는 것.
create policy profiles_self_select on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ── 초대 토큰 검증 헬퍼 ─────────────────────────────────────────────────────
-- 서버 액션에서 호출한다. 유효하면 team_id, 아니면 NULL.
create or replace function public.team_for_invite(p_token uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.invites
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now())
$$;

revoke all on function public.team_for_invite(uuid) from public, anon, authenticated;

-- ── 월 사용량 조회 (AI 상한 판정용) ─────────────────────────────────────────
create or replace function public.ai_usage_this_month(p_ledger_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.ai_extractions
   where ledger_id = p_ledger_id
     and succeeded
     and created_at >= date_trunc('month', now())
$$;

revoke all on function public.ai_usage_this_month(uuid) from public, anon, authenticated;
