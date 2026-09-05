-- ============================================================================
-- Ledger — 0018 항목별 청구 (§10.4)
--
-- 같이 배달을 시키고 한 사람이 결제하는 일이 잦다. 그때 영수증 한 장 안에서
-- 부담이 갈린다 — 마라탕은 시킨 사람이, 배달비는 다 같이.
--
-- 지금까지의 부담 방식 셋(all · partial · personal)은 **영수증 한 장에 한 가지**를
-- 전제한다. 그래서 이런 영수증은 두 줄로 쪼개 적어야 했다. 쪼개 적으면 장부에
-- 없는 지출이 두 건 생기고, 영수증 사진은 그중 한 줄에만 붙는다.
--
-- 네 번째 방식 items 를 둔다. 영수증은 한 줄로 남고, 그 안에서 줄마다 부담자가
-- 다르다. 배달비는 '팀원 전원이 들어 있는 줄'일 뿐 특별한 종류가 아니다 —
-- 그래야 "배달비도 두 명만" 같은 경우가 예외 없이 그냥 된다.
--
-- 지분의 합 = amount 는 여기서 반드시 지켜져야 한다. 어긋나면 정산 화면의
-- 숫자가 조용히 틀린다. 그래서 앱에도 검사가 있지만 DB 에도 건다. 두 겹으로 둔다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.
-- 맨 앞의 ALTER TYPE 이 트랜잭션 문제로 걸리면 그 한 줄만 먼저 실행하고
-- 나머지를 이어서 실행한다.
-- ============================================================================

alter type public.allocation_type add value if not exists 'items';

-- 아래에서 열거형 리터럴 'items' 를 직접 쓰지 않고 allocation::text 로 비교하는
-- 이유가 이것이다. 같은 트랜잭션 안에서는 방금 추가한 값을 리터럴로 쓸 수 없다.

alter table public.expenses
  add column if not exists item_lines jsonb;

comment on column public.expenses.item_lines is
  'allocation = items 일 때만. [{name, amount, memberIds[]}] — 합은 amount 와 같아야 한다.';

-- ── 1. 모양 ─────────────────────────────────────────────────────────────────
alter table public.expenses drop constraint if exists items_needs_lines;
alter table public.expenses add constraint items_needs_lines check (
  (allocation::text = 'items'
     and item_lines is not null
     and jsonb_typeof(item_lines) = 'array'
     and jsonb_array_length(item_lines) >= 1)
  or (allocation::text <> 'items' and item_lines is null)
);

-- ── 2. 합과 부담자 ──────────────────────────────────────────────────────────
-- CHECK 로는 못 쓴다(집계·배열 비교가 들어간다). 트리거로 건다.
create or replace function public.guard_expense_item_lines()
returns trigger language plpgsql as $$
declare
  v_sum      bigint;
  v_noname   int;
  v_empty    int;
  v_notuuid  int;
  v_stray    int;
  v_dup      int;
begin
  if new.allocation::text <> 'items' then return new; end if;

  -- 금액이 정수로 읽히지 않는 줄이 하나라도 있으면 여기서 예외가 난다. 옳다.
  select coalesce(sum((l->>'amount')::bigint), 0)
    into v_sum
    from jsonb_array_elements(new.item_lines) as l;

  if v_sum <> new.amount then
    raise exception
      '항목 금액의 합(%)이 결제 금액(%)과 다릅니다. 영수증 한 장의 줄을 다 적었는지 확인하세요.',
      v_sum, new.amount
      using errcode = 'check_violation';
  end if;

  select count(*) into v_noname
    from jsonb_array_elements(new.item_lines) as l
   where coalesce(l->>'name', '') = '';
  if v_noname > 0 then
    raise exception '이름이 없는 항목 줄이 있습니다.' using errcode = 'check_violation';
  end if;

  select count(*) into v_empty
    from jsonb_array_elements(new.item_lines) as l
   where jsonb_typeof(l->'memberIds') is distinct from 'array'
      or jsonb_array_length(l->'memberIds') = 0;
  if v_empty > 0 then
    raise exception '부담자가 지정되지 않은 항목 줄이 있습니다.' using errcode = 'check_violation';
  end if;

  -- uuid 가 아닌 값을 캐스팅하면 알아듣기 어려운 오류가 난다. 먼저 걸러 말해 준다.
  select count(*) into v_notuuid
    from jsonb_array_elements(new.item_lines) as l,
         jsonb_array_elements_text(l->'memberIds') as m
   where m !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  if v_notuuid > 0 then
    raise exception '항목 부담자 값이 팀원 id 가 아닙니다.' using errcode = 'check_violation';
  end if;

  -- 명단 밖 사람이 섞이면 지분 합이 금액과 어긋난다. 0002 의 규칙과 같은 규칙이다.
  select count(*) into v_stray
    from jsonb_array_elements(new.item_lines) as l,
         jsonb_array_elements_text(l->'memberIds') as m
   where not (m::uuid = any (new.team_member_ids));
  if v_stray > 0 then
    raise exception '항목 부담자는 그 지출의 기록 시점 팀원 명단 안에 있어야 합니다.'
      using errcode = 'check_violation';
  end if;

  -- 한 줄에 같은 사람이 두 번 들어가면 그 사람만 두 몫을 낸다.
  select count(*) into v_dup
    from jsonb_array_elements(new.item_lines) as l
   where (select count(*) from jsonb_array_elements_text(l->'memberIds')) <>
         (select count(distinct m) from jsonb_array_elements_text(l->'memberIds') as m);
  if v_dup > 0 then
    raise exception '한 항목 줄에 같은 사람이 두 번 들어 있습니다.' using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists expenses_item_lines_sound on public.expenses;
create trigger expenses_item_lines_sound
  before insert or update on public.expenses
  for each row execute function public.guard_expense_item_lines();

-- ── 3. 보정·환불은 원본의 '줄 구조'를 따른다 ────────────────────────────────
-- 0002 의 4번 가드는 부담 구조가 원본과 같기를 요구한다. items 에서 '구조'는
-- 줄의 이름과 부담자이지 금액이 아니다 — 금액은 바로 그 보정이 고치려는 것이다.
-- 그래서 금액을 뺀 모양만 비교한다.
create or replace function public.item_lines_shape(lines jsonb)
returns jsonb language sql immutable as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('name', l->>'name', 'who', l->'memberIds') order by ord),
    '[]'::jsonb)
  from jsonb_array_elements(coalesce(lines, '[]'::jsonb)) with ordinality as t(l, ord)
$$;

create or replace function public.guard_adjustment_matches_target()
returns trigger language plpgsql as $$
declare t record;
begin
  if new.adjustment_target_id is null then return new; end if;

  select * into t from public.expenses where id = new.adjustment_target_id;
  if not found then
    raise exception '보정 대상 지출을 찾을 수 없습니다.' using errcode = 'foreign_key_violation';
  end if;

  if t.adjustment_target_id is not null then
    raise exception '보정 항목을 다시 보정할 수 없습니다. 원본 지출을 대상으로 기록하세요.'
      using errcode = 'check_violation';
  end if;

  if t.ledger_id <> new.ledger_id then
    raise exception '보정 항목은 원본과 같은 장부에 있어야 합니다.' using errcode = 'check_violation';
  end if;

  if new.allocation <> t.allocation
     or new.team_member_ids is distinct from t.team_member_ids
     or new.participant_member_ids is distinct from t.participant_member_ids
     or new.owner_member_id is distinct from t.owner_member_id
     or public.item_lines_shape(new.item_lines)
        is distinct from public.item_lines_shape(t.item_lines) then
    raise exception '보정·환불 항목의 부담 구조는 원본과 같아야 합니다. (target=%)', t.id
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

-- ── 4. 정산이 끝난 뒤에는 줄도 못 고친다 ────────────────────────────────────
-- 0013 이 잠가 둔 '숫자에 닿는 칸' 목록에 item_lines 가 빠져 있으면,
-- 정산된 지출의 부담자를 줄 단위로 바꿀 수 있게 된다. 같은 자리에 넣는다.
create or replace function public.guard_settled_expense()
returns trigger language plpgsql as $$
declare
  v_settled boolean;
begin
  select exists (select 1 from public.settlement_expenses se
                  where se.expense_id = coalesce(old.id, new.id))
    into v_settled;

  if not v_settled then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception
      '이미 정산된 지출은 삭제할 수 없습니다. (expense_id=%)', old.id
      using errcode = 'restrict_violation';
  end if;

  if new.spent_on               is distinct from old.spent_on
  or new.amount                 is distinct from old.amount
  or new.payer_member_id        is distinct from old.payer_member_id
  or new.allocation             is distinct from old.allocation
  or new.team_member_ids        is distinct from old.team_member_ids
  or new.participant_member_ids is distinct from old.participant_member_ids
  or new.owner_member_id        is distinct from old.owner_member_id
  or new.item_lines             is distinct from old.item_lines
  or new.adjustment_kind        is distinct from old.adjustment_kind
  or new.adjustment_target_id   is distinct from old.adjustment_target_id
  or new.ledger_id              is distinct from old.ledger_id then
    raise exception
      '이미 정산된 지출의 금액·날짜·결제자·부담 방식은 바꿀 수 없습니다. 보정 항목을 새로 기록하세요. (expense_id=%)',
      old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end $$;
