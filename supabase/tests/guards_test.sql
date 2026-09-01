-- ============================================================================
-- Ledger — 스키마 가드 테스트
--
--   psql -d ledger_test -f supabase/tests/guards_test.sql
--
-- 회계 규칙이 앱 코드가 아니라 DB에서 막히는지 확인한다.
-- ============================================================================

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages to notice;

-- ── 픽스처 ──────────────────────────────────────────────────────────────────
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000aa');
insert into public.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000aa', '관우');
insert into public.teams (id, name, owner_id)
  values ('10000000-0000-0000-0000-000000000001', 'DESIGN STUDIO 02', '00000000-0000-0000-0000-0000000000aa');
insert into public.members (id, team_id, display_name, sort_order) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '관우', 1),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '민수', 2),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '지수', 3),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '현우', 4),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '태윤', 5);
insert into public.ledgers (id, team_id, name)
  values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-2학기 디자인 스튜디오');

-- 명단 스냅샷
create temporary view roster4 as select array[
  '20000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000002'::uuid,
  '20000000-0000-0000-0000-000000000003'::uuid, '20000000-0000-0000-0000-000000000004'::uuid] as ids;

insert into public.expenses (id, ledger_id, spent_on, title, amount, payer_member_id, team_member_ids, allocation)
select '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '2026-09-01',
       '폼보드 5T 5장', 32500, '20000000-0000-0000-0000-000000000001', ids, 'all' from roster4;

insert into public.expenses (id, ledger_id, spent_on, title, amount, payer_member_id, team_member_ids,
                             allocation, participant_member_ids)
select '40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '2026-09-15',
       '팀 회의 카페', 21500, '20000000-0000-0000-0000-000000000003', ids, 'partial',
       array['20000000-0000-0000-0000-000000000002'::uuid, '20000000-0000-0000-0000-000000000003'::uuid,
             '20000000-0000-0000-0000-000000000004'::uuid] from roster4;

-- 1차 정산 확정
insert into public.settlements (id, ledger_id, label, snapshot)
  values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
          '1차 중간 정산', '{"totalAmount":54000}'::jsonb);
insert into public.settlement_expenses (settlement_id, expense_id) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002');

-- ── 테스트 러너 ─────────────────────────────────────────────────────────────
create or replace function pg_temp.must_fail(label text, stmt text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
    raise notice '  ✗ % — 막혔어야 하는데 통과했다', label;
  exception when others then
    raise notice '  ✓ %', label;
  end;
end $$;

create or replace function pg_temp.must_pass(label text, stmt text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
    raise notice '  ✓ %', label;
  exception when others then
    raise notice '  ✗ % — %', label, sqlerrm;
  end;
end $$;

do $$ begin raise notice ''; raise notice '[정산 후 불변성]'; end $$;

select pg_temp.must_fail('정산된 지출은 수정할 수 없다',
  $$update public.expenses set amount = 35000 where id = '40000000-0000-0000-0000-000000000001'$$);

-- 0012. 정산된 지출도 지울 수 있다 — 다만 그 정산이 함께 걷어진다.
-- 직접 DELETE 하는 길은 여전히 막혀 있고, 함수를 거쳐야만 열린다.
select pg_temp.must_fail('정산된 지출을 직접 삭제할 수는 없다',
  $$delete from public.expenses where id = '40000000-0000-0000-0000-000000000001'$$);

-- 0011. 사진 두 칸만은 예외다. 금액이 아니라 금액의 근거이기 때문이다.
select pg_temp.must_pass('정산된 지출이라도 영수증 사진은 붙일 수 있다',
  $$update public.expenses set receipt_path = 'x/y/receipt-1.jpg'
     where id = '40000000-0000-0000-0000-000000000001'$$);

select pg_temp.must_pass('정산된 지출이라도 품목 사진은 뗄 수 있다',
  $$update public.expenses set representative_image_path = null
     where id = '40000000-0000-0000-0000-000000000001'$$);

select pg_temp.must_fail('사진과 금액을 함께 바꾸면 막힌다',
  $$update public.expenses set receipt_path = 'x/y/receipt-2.jpg', amount = 999
     where id = '40000000-0000-0000-0000-000000000001'$$);

select pg_temp.must_fail('확정된 정산의 snapshot은 바꿀 수 없다',
  $$update public.settlements set snapshot = '{"totalAmount":1}'::jsonb
     where id = '50000000-0000-0000-0000-000000000001'$$);

select pg_temp.must_fail('한 지출이 두 정산에 들어갈 수 없다',
  $$insert into public.settlements (id, ledger_id, label, snapshot)
      values ('50000000-0000-0000-0000-000000000009','30000000-0000-0000-0000-000000000001','중복','{}'::jsonb);
    insert into public.settlement_expenses (settlement_id, expense_id)
      values ('50000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000001')$$);

-- 0012. 함수를 거치면 정산된 지출도 지워진다. 그때 정산도 함께 사라진다.
do $$
declare n integer; m integer;
begin
  -- 아직 아무도 확인하지 않은 정산 하나를 새로 만든다.
  insert into public.settlements (id, ledger_id, label, snapshot)
    values ('50000000-0000-0000-0000-000000000007','30000000-0000-0000-0000-000000000001',
            '삭제 시험','{}'::jsonb);
  insert into public.expenses (id, ledger_id, spent_on, title, amount, payer_member_id,
                               team_member_ids, allocation)
    values ('40000000-0000-0000-0000-000000000077','30000000-0000-0000-0000-000000000001',
            '2026-10-01','지울 줄',10000,'20000000-0000-0000-0000-000000000001',
            (select ids from roster4),'all');
  insert into public.settlement_expenses (settlement_id, expense_id)
    values ('50000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000077');

  perform public.delete_expense_deep('40000000-0000-0000-0000-000000000077',
                                     '30000000-0000-0000-0000-000000000001');

  select count(*) into n from public.expenses
   where id = '40000000-0000-0000-0000-000000000077';
  select count(*) into m from public.settlements
   where id = '50000000-0000-0000-0000-000000000007';

  if n = 0 and m = 0 then
    raise notice '  ✓ 정산된 지출을 지우면 그 정산도 함께 걷어진다';
  else
    raise notice '  ✗ 지출 % 건, 정산 % 건이 남았다', n, m;
  end if;
end $$;

do $$ begin raise notice ''; raise notice '[부담 구조]'; end $$;

select pg_temp.must_fail('명단 밖 사람에게 비용을 부담시킬 수 없다',
  $$insert into public.expenses (ledger_id, spent_on, title, amount, payer_member_id,
      team_member_ids, allocation, participant_member_ids)
    values ('30000000-0000-0000-0000-000000000001','2026-09-20','명단 밖 택시',10000,
      '20000000-0000-0000-0000-000000000001',
      array['20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000002'::uuid],
      'partial', array['20000000-0000-0000-0000-000000000005'::uuid])$$);

select pg_temp.must_fail('명단 밖 사람이 결제자가 될 수 없다',
  $$insert into public.expenses (ledger_id, spent_on, title, amount, payer_member_id, team_member_ids, allocation)
    values ('30000000-0000-0000-0000-000000000001','2026-09-20','명단 밖 결제',10000,
      '20000000-0000-0000-0000-000000000005',
      array['20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000002'::uuid],'all')$$);

select pg_temp.must_fail('일부 인원 부담인데 참여자가 비어 있을 수 없다',
  $$insert into public.expenses (ledger_id, spent_on, title, amount, payer_member_id, team_member_ids, allocation)
    values ('30000000-0000-0000-0000-000000000001','2026-09-20','참여자 없음',10000,
      '20000000-0000-0000-0000-000000000001',
      array['20000000-0000-0000-0000-000000000001'::uuid],'partial')$$);

select pg_temp.must_fail('금액 0원은 기록할 수 없다',
  $$insert into public.expenses (ledger_id, spent_on, title, amount, payer_member_id, team_member_ids, allocation)
    values ('30000000-0000-0000-0000-000000000001','2026-09-20','0원',0,
      '20000000-0000-0000-0000-000000000001',
      array['20000000-0000-0000-0000-000000000001'::uuid],'all')$$);

do $$ begin raise notice ''; raise notice '[보정 · 환불]'; end $$;

select pg_temp.must_pass('이미 정산된 지출의 보정 항목은 기록할 수 있다',
  $$insert into public.expenses (id, ledger_id, spent_on, title, amount, payer_member_id, team_member_ids,
      allocation, participant_member_ids, adjustment_kind, adjustment_target_id, adjustment_reason)
    values ('40000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000001','2026-10-19',
      '팀 회의 카페 금액 보정', 2000, '20000000-0000-0000-0000-000000000003',
      array['20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000002'::uuid,
            '20000000-0000-0000-0000-000000000003'::uuid,'20000000-0000-0000-0000-000000000004'::uuid],
      'partial',
      array['20000000-0000-0000-0000-000000000002'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,
            '20000000-0000-0000-0000-000000000004'::uuid],
      'correction','40000000-0000-0000-0000-000000000002','영수증 재확인')$$);

select pg_temp.must_fail('보정 항목의 부담 구조가 원본과 다르면 막힌다',
  $$insert into public.expenses (ledger_id, spent_on, title, amount, payer_member_id, team_member_ids,
      allocation, adjustment_kind, adjustment_target_id)
    select '30000000-0000-0000-0000-000000000001','2026-10-19','잘못된 보정',1000,
      '20000000-0000-0000-0000-000000000001', ids, 'all','correction',
      '40000000-0000-0000-0000-000000000002' from roster4$$);

select pg_temp.must_fail('환불 금액은 양수일 수 없다',
  $$insert into public.expenses (ledger_id, spent_on, title, amount, payer_member_id, team_member_ids,
      allocation, adjustment_kind, adjustment_target_id)
    select '30000000-0000-0000-0000-000000000001','2026-10-18','잘못된 환불', 8900,
      '20000000-0000-0000-0000-000000000001', ids, 'all','refund',
      '40000000-0000-0000-0000-000000000001' from roster4$$);

select pg_temp.must_pass('환불은 음수로 기록된다',
  $$insert into public.expenses (ledger_id, spent_on, title, amount, payer_member_id, team_member_ids,
      allocation, adjustment_kind, adjustment_target_id)
    select '30000000-0000-0000-0000-000000000001','2026-10-18','폼보드 1장 반품', -8900,
      '20000000-0000-0000-0000-000000000001', ids, 'all','refund',
      '40000000-0000-0000-0000-000000000001' from roster4$$);

select pg_temp.must_fail('보정 항목을 다시 보정할 수 없다',
  $$insert into public.expenses (ledger_id, spent_on, title, amount, payer_member_id, team_member_ids,
      allocation, participant_member_ids, adjustment_kind, adjustment_target_id)
    values ('30000000-0000-0000-0000-000000000001','2026-10-20','보정의 보정',500,
      '20000000-0000-0000-0000-000000000003',
      array['20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000002'::uuid,
            '20000000-0000-0000-0000-000000000003'::uuid,'20000000-0000-0000-0000-000000000004'::uuid],
      'partial',
      array['20000000-0000-0000-0000-000000000002'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,
            '20000000-0000-0000-0000-000000000004'::uuid],
      'correction','40000000-0000-0000-0000-00000000000a')$$);

do $$ begin raise notice ''; raise notice '[정산 번호]'; end $$;

do $$
declare n integer;
begin
  insert into public.settlements (ledger_id, label, snapshot)
    values ('30000000-0000-0000-0000-000000000001','2차 정산','{}'::jsonb) returning seq into n;
  if n = 2 then raise notice '  ✓ 정산 번호가 장부 안에서 자동으로 이어진다 (#%)', n;
  else raise notice '  ✗ 정산 번호가 어긋났다 (%)', n; end if;
end $$;

do $$ begin raise notice ''; raise notice '[접근 제어]'; end $$;

do $$
declare unprotected text;
begin
  select string_agg(c.relname, ', ') into unprotected
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if unprotected is null then raise notice '  ✓ public 스키마의 모든 테이블에 RLS가 켜져 있다';
  else raise notice '  ✗ RLS가 꺼진 테이블: %', unprotected; end if;
end $$;

do $$
declare leaky text;
begin
  select string_agg(distinct tablename, ', ') into leaky
    from pg_policies
   where schemaname = 'public'
     and (roles::text[] && array['anon'])
     and tablename <> 'profiles';
  if leaky is null then raise notice '  ✓ anon 역할에 열린 정책이 없다 (기본 거부)';
  else raise notice '  ✗ anon에 열린 테이블: %', leaky; end if;
end $$;

do $$ begin raise notice ''; end $$;

-- ── 0004 송금 ───────────────────────────────────────────────────────────────
do $$ begin raise notice '[송금 확인 · 정산 취소]'; end $$;

insert into public.transfers (id, settlement_id, from_member_id, to_member_id, amount) values
  ('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001', 12000),
  ('60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001', 8000);

select pg_temp.must_fail('보낸 사람은 송금 완료를 확인할 수 없다',
  $$update public.transfers set confirmed_at = now(),
      confirmed_by_member_id = '20000000-0000-0000-0000-000000000004'
     where id = '60000000-0000-0000-0000-000000000001'$$);

select pg_temp.must_fail('제3자도 확인할 수 없다',
  $$update public.transfers set confirmed_at = now(),
      confirmed_by_member_id = '20000000-0000-0000-0000-000000000003'
     where id = '60000000-0000-0000-0000-000000000001'$$);

select pg_temp.must_pass('아무도 확인하지 않은 정산은 취소된다',
  $$select public.cancel_settlement('50000000-0000-0000-0000-000000000009',
                                    '30000000-0000-0000-0000-000000000001')$$);

-- 0010. 장부가 다르면 지워지지 않는다. 남의 장부 정산 id를 알아도 소용없어야 한다.
do $$
declare n integer;
begin
  insert into public.settlements (id, ledger_id, label, snapshot)
    values ('50000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000001', '남의 장부 시험', '{}'::jsonb);
  perform public.cancel_settlement('50000000-0000-0000-0000-000000000008',
                                   '30000000-0000-0000-0000-0000000000ff');
  select count(*) into n from public.settlements
   where id = '50000000-0000-0000-0000-000000000008';
  if n = 1 then raise notice '  ✓ 다른 장부 id로는 정산이 취소되지 않는다';
  else raise notice '  ✗ 장부가 달라도 정산이 취소됐다'; end if;
  delete from public.settlements where id = '50000000-0000-0000-0000-000000000008';
end $$;

select pg_temp.must_pass('받은 사람은 송금 완료를 확인할 수 있다',
  $$update public.transfers set confirmed_at = now(),
      confirmed_by_member_id = '20000000-0000-0000-0000-000000000001'
     where id = '60000000-0000-0000-0000-000000000001'$$);

select pg_temp.must_fail('확인된 송금은 되돌릴 수 없다',
  $$update public.transfers set confirmed_at = null, confirmed_by_member_id = null
     where id = '60000000-0000-0000-0000-000000000001'$$);

select pg_temp.must_fail('송금이 한 건이라도 확인되면 정산을 취소할 수 없다',
  $$select public.cancel_settlement('50000000-0000-0000-0000-000000000001',
                                    '30000000-0000-0000-0000-000000000001')$$);

do $$
declare n integer;
begin
  select count(*) into n from public.open_transfers('30000000-0000-0000-0000-000000000001');
  if n = 1 then raise notice '  ✓ 미확인 송금만 남는다 (%건)', n;
  else raise notice '  ✗ 미확인 송금 수가 어긋났다 (%)', n; end if;
end $$;

do $$ begin raise notice ''; end $$;

-- ── 0005 통화 ───────────────────────────────────────────────────────────────
do $$ begin raise notice '[통화 잠금]'; end $$;

select pg_temp.must_fail('지출이 있는 장부의 통화는 바꿀 수 없다',
  $$update public.ledgers set currency = 'USD' where id = '30000000-0000-0000-0000-000000000001'$$);

insert into public.ledgers (id, team_id, name)
  values ('30000000-0000-0000-0000-0000000000ff', '10000000-0000-0000-0000-000000000001', '빈 장부');

select pg_temp.must_pass('아직 비어 있는 장부의 통화는 정할 수 있다',
  $$update public.ledgers set currency = 'USD' where id = '30000000-0000-0000-0000-0000000000ff'$$);

select pg_temp.must_fail('없는 통화 코드는 거부된다',
  $$update public.ledgers set currency = 'XYZ' where id = '30000000-0000-0000-0000-0000000000ff'$$);

do $$ begin raise notice ''; end $$;
