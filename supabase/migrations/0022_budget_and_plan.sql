-- ============================================================================
-- Ledger — 0022 예산 한 칸, 경계 한 칸
--
-- 서로 다른 두 가지를 한 파일에 담는다. 둘 다 ledgers 의 칸 하나씩이고,
-- 마이그레이션을 하나 더 만드는 것보다 배포에서 실수할 자리가 적다.
--
-- ── budget — 이 회기에 쓸 수 있는 돈 (§14)
--
-- **적지 않아도 된다.** 공금 장부에서 예산은 이미 장부 안에 있다 — 회비와
-- 지원금으로 들어온 돈이 곧 쓸 수 있는 돈이다(lib/domain/ahead.ts).
-- 이 칸은 그 값이 사실과 다를 때를 위한 자리다: "지원금 200만원을 받기로
-- 했는데 아직 안 들어왔다"면 들어온 돈은 예산이 아니다.
--
-- 그래서 nullable 이고, NULL 은 "장부가 알아내라"는 뜻으로 정확히 맞는다.
--
-- ── plan — 값의 경계 (§D)
--
-- 지금은 아무 데서도 안 읽는다. 전부 'pro' 로 두고 시작한다.
--
-- 그런데도 지금 심는 이유는, **나중에 벽을 세우는 것은 쉽고 없던 경계를
-- 뒤늦게 뚫는 것은 어렵기** 때문이다. 칸이 없으면 "이 장부는 어느 쪽인가"를
-- 묻는 코드가 생길 때마다 임시 판정이 하나씩 늘고, 그 판정들이 서로 다른
-- 답을 내기 시작하면 되돌릴 방법이 없다.
--
-- 무엇을 팔지는 아직 안 정했다. 설계에서 못 박은 것은 두 가지뿐이다 —
-- **검사(§13)는 유료로 돌리지 않는다**(무료 장부가 틀린 채로 굴러가도 되는
-- 장부가 된다), **모델 등급으로 팔지 않는다**("무료는 싼 모델"은 회계
-- 서비스에서 "당신 장부의 숫자는 덜 믿어도 된다"로 읽힌다).
--
-- 여러 번 실행해도 안전하다.
-- Supabase SQL Editor 에서 한 번 실행한다.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ledger_plan') then
    create type public.ledger_plan as enum ('free', 'pro');
  end if;
end $$;

alter table public.ledgers
  add column if not exists budget bigint
    check (budget is null or budget > 0),
  -- 지금은 전부 pro 다. 벽은 아직 안 세운다.
  add column if not exists plan public.ledger_plan not null default 'pro';

comment on column public.ledgers.budget is
  '이 회기에 쓸 수 있는 돈. NULL 이면 들어온 돈에서 장부가 알아낸다 (§14)';
comment on column public.ledgers.plan is
  '값의 경계. 지금은 아무 데서도 안 읽고 전부 pro 다 — 나중에 뚫기 어려워서 미리 심어 둔다';

-- ── 되돌리기 ────────────────────────────────────────────────────────────
--
--   alter table public.ledgers drop column if exists budget;
--   alter table public.ledgers drop column if exists plan;
--   drop type if exists public.ledger_plan;
--
-- 둘 다 정산에도 결산에도 안 들어가므로, 지워도 숫자는 그대로다.
