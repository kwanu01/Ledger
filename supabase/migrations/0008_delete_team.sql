-- ════════════════════════════════════════════════════════════════════════════
-- 0008 · 장부 통째로 지우기
--
-- 이 장부에는 지키는 규칙이 두 개 있다.
--
--   settlements_cancel_guard        확인된 송금이 하나라도 있는 정산은 못 지운다.
--   expenses_no_delete_after_settlement  정산에 묶인 지출은 못 지운다.
--
-- 둘 다 맞는 규칙이다. 쓰고 있는 장부에서 정산이 소리 없이 취소되면 그 뒤의
-- 숫자가 전부 거짓말이 된다. 다만 이 규칙은 "살아 있는 장부를 지킨다"는 뜻이지
-- "장부를 영영 못 지운다"는 뜻이 아니다. 팀을 지우는 것은 사람이 두 번 눌러
-- 결정한, 장부 전체를 없애는 일이다.
--
-- 그래서 규칙을 끄지 않는다. 대신 규칙이 성립하지 않는 순서로 지운다.
--
--   1. 송금       — 지우고 나면 "확인된 송금"이 0건이 된다
--   2. 정산       — 그래서 취소 규칙을 통과한다 (settlement_expenses는 cascade)
--   3. 지출       — 그래서 정산에 묶인 지출이 없어진다
--   4. 팀         — members·invites·ledgers는 cascade로 따라 지워진다
--
-- 한 함수 안에서 한 트랜잭션으로 돈다. 중간에 실패하면 전부 없던 일이 된다.
-- 네 번 나눠 부르면 반쯤 지워진 장부가 남을 수 있다.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.delete_team(p_team_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.transfers t
   using public.settlements s, public.ledgers l
   where t.settlement_id = s.id and s.ledger_id = l.id and l.team_id = p_team_id;

  delete from public.settlements s
   using public.ledgers l
   where s.ledger_id = l.id and l.team_id = p_team_id;

  -- 보정 항목은 원래 지출을 가리킨다(adjustment_target_id). 한 문장으로 지우면
  -- 참조 검사가 문장 끝에 한 번 돌아서 둘이 함께 없어진다.
  delete from public.expenses e
   using public.ledgers l
   where e.ledger_id = l.id and l.team_id = p_team_id;

  delete from public.teams where id = p_team_id;
end $$;

-- 서버 코드(service role)만 부른다. 소유자 확인은 그쪽에서 이미 한다.
revoke all on function public.delete_team(uuid) from public, anon, authenticated;
