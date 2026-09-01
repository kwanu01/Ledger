-- ══════════════════════════════════════════════════════════════════════
-- 0010 · 정산 취소에 장부 조건을 건다
--
-- cancel_settlement(p_settlement_id) 은 id 하나만 보고 지웠다. 그래서 자기
-- 장부의 회원인 사람이 **남의 장부 정산 id**를 넣으면 그 정산이 지워졌다.
-- 앱은 "이 사람이 이 장부에 들어올 수 있는가"만 확인하고, "이 정산이 그
-- 장부의 것인가"는 확인하지 않았다. 두 가지는 다른 질문이다.
--
-- id가 uuid라 추측은 어렵지만, 한 번 새 나간 id는 영원히 유효한 열쇠가 된다.
-- 경계는 추측 난이도가 아니라 조건으로 지켜야 한다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.
-- ══════════════════════════════════════════════════════════════════════

create or replace function public.cancel_settlement(
  p_settlement_id uuid,
  p_ledger_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.settlements
   where id = p_settlement_id
     and ledger_id = p_ledger_id;   -- ← 이 줄이 이 마이그레이션의 전부다
end;
$$;

-- 옛 한 인자 판은 없앤다. 남겨 두면 그쪽으로 다시 새어 나간다.
drop function if exists public.cancel_settlement(uuid);

revoke all on function public.cancel_settlement(uuid, uuid) from public, anon, authenticated;
