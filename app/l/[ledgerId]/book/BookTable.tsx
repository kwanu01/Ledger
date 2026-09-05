'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteExpenses, settle } from '../../../actions/ledger.ts';
import {
  adjustmentsFor,
  breakdownOf,
  lineSharesOf,
  effectiveAmount,
  nameOf,
  settledExpenseIds,
  needsSettling,
  byEntryOrder,
  groupsOf,
} from '../../../../lib/domain/settlement.ts';
import { adjustmentLabel, allocationLabel } from '../../../../lib/labels.ts';
import { translator } from '../../../../lib/i18n.ts';
import {
  formatEntryAmount,
  formatMoney,
  type CurrencyCode,
  type Locale,
} from '../../../../lib/domain/money.ts';
import type { Ledger } from '../../../../lib/domain/types.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';
import ImageField from '../../../ImageField.tsx';
import DeleteExpense from './DeleteExpense.tsx';
import EditExpense from './EditExpense.tsx';
import Relabel from './Relabel.tsx';

/**
 * 장부 (§21.3)
 *
 * 한 줄이 한 건이고, 줄을 누르면 그 건이 어떻게 갈라졌는지 그 자리에서 펼쳐진다.
 * 정산이 끝난 줄에는 도장이 찍히고 더 이상 고를 수 없다.
 */

type SortKey = 'date' | 'amount';
type FoldKey = 'none' | 'group' | 'month' | 'category' | 'payer';

export default function BookTable({
  ledger,
  lang,
  openSeqs = [],
}: {
  ledger: Ledger;
  lang: Locale;
  /**
   * 아직 확인되지 않은 송금이 남아 있는 정산 회차.
   *
   * 도장은 "숫자를 확정했다"가 아니라 **"돈이 다 오갔다"**는 표시다.
   * 확정과 송금 완료는 다른 사실이고, 장부에 다른 사실을 같은 표시로
   * 적으면 그 장부는 못 믿는 물건이 된다.
   */
  openSeqs?: number[];
}) {
  const router = useRouter();
  // 경고는 도우미 말풍선 한 자리로 모인다(app/helper).
  const { say } = useHelper();
  const currency: CurrencyCode = ledger.currency ?? 'KRW';
  const cash = (n: number) => formatMoney(n, currency, lang);
  const entry = (n: number) => formatEntryAmount(n, currency, lang, true);
  const who = (id: string) => nameOf(ledger.members, id);
  const T = translator(lang);

  const [key, setKey] = useState<SortKey>('date');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastPicked, setLastPicked] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  /*
   * 접어 보기 (§11.3)
   *
   * 장부가 스무 줄을 넘어가면 통째로는 안 읽힌다. 읽는 사람이 실제로 하는
   * 물음은 "MT 때 얼마 썼지", "이번 달 얼마지", "현우가 얼마나 결제했지"
   * 같은 것이고, 그건 전부 **같은 줄들을 다른 기준으로 묶어 소계를 보는 일**이다.
   *
   * 그러니 화면만 접는다. 저장된 것은 하나도 달라지지 않는다.
   */
  const [fold, setFold] = useState<FoldKey>('none');
  /** 접어 둔 덩어리. 펴 둔 것이 기본이라 '접은 것'만 센다. */
  const [shut, setShut] = useState<Set<string>>(new Set());
  /** 지금 고치는 중인 줄. 한 번에 하나만 연다. */
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const settled = useMemo(() => settledExpenseIds(ledger), [ledger]);
  /** 이미 쓰인 묶음 이름들. 고치는 자리의 고를 목록으로 내려보낸다. */
  const groups = useMemo(() => groupsOf(ledger), [ledger]);

  // 전표 번호는 언제나 시간 순서로 매긴다. 정렬을 바꿔도 번호는 따라 움직이지 않는다.
  const slips = useMemo(() => {
    const map = new Map<string, string>();
    [...ledger.expenses]
      .sort(byEntryOrder)
      .forEach((e, i) => map.set(e.id, String(i + 1).padStart(3, '0')));
    return map;
  }, [ledger]);

  const list = useMemo(() => {
    const chrono = [...ledger.expenses].sort((a, b) =>
      byEntryOrder(a, b),
    );
    if (key === 'amount') {
      const d = dir === 'asc' ? 1 : -1;
      return [...chrono].sort((a, b) => (a.amount - b.amount) * d);
    }
    return dir === 'asc' ? chrono : [...chrono].reverse();
  }, [ledger, key, dir]);

  // 마감선은 시간 순서 위에서만 뜻이 있다. 금액순으로 늘어놓으면 구획이 성립하지 않는다.
  // 접어 놓으면 시간 순서가 덩어리 안에서만 성립하므로 마감선도 성립하지 않는다.
  const chronological = key === 'date' && dir === 'asc' && fold === 'none';
  const closings = chronological
    ? [...ledger.settlements].sort((a, b) => (a.date < b.date ? -1 : 1))
    : [];

  /* 지출 한 줄이 어느 회차에 들어갔는지. 그 회차의 송금이 다 끝났을 때만
     그 줄에 도장이 찍힌다. */
  const seqOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const st of ledger.settlements) {
      for (const id of st.snapshot.expenseIds) m.set(id, st.seq);
    }
    return m;
  }, [ledger]);
  const waiting = (seq: number | undefined) => seq !== undefined && openSeqs.includes(seq);

  /*
   * 고를 수 있는 줄.
   *
   * '아직 정산에 안 들어간 줄'이 아니라 **'정산할 것이 남은 줄'**이다. 둘은
   * 다르다 — 자기가 사서 자기가 가져간 줄은 어느 정산에도 안 들어가지만
   * 정산할 것이 애초에 없다. 그 줄까지 세는 바람에 '정산 불필요' 한 줄짜리
   * 장부 아래에 '미정산 1건'이 떠 있었다. 고르면 '전체 정산'이 켜지지만
   * 눌러도 그 줄에서는 아무 송금도 나오지 않는다.
   *
   * 같은 판정을 화면 두 곳이 서로 다르게 하고 있었다. 줄에는 needsSettling
   * 으로 '정산 불필요'라 적어 놓고, 아래 셈은 뺄셈으로 세고 있었다.
   * 판정은 한 군데서만 한다.
   */
  const pickable = list.filter((e) => !settled.has(e.id) && needsSettling(e)).map((e) => e.id);

  /*
   * 줄들을 덩어리로 나눈다.
   *
   * 덩어리의 순서는 **처음 나온 순서**다. 가나다순으로 세우면 '1차 MT' 다음이
   * '2차 MT'가 아닐 수 있고, 무엇보다 정렬을 바꿀 때마다 덩어리가 자리를 옮겨
   * 다녀 손이 기억한 위치가 소용없어진다.
   */
  const sections = useMemo(() => {
    if (fold === 'none') return [{ key: '', label: '', items: list }];

    const keyOf = (e: (typeof list)[number]) => {
      if (fold === 'group') return e.group?.trim() || '';
      if (fold === 'month') return e.date.slice(0, 7);
      if (fold === 'category') return e.category?.trim() || '';
      return e.payerId;
    };
    const labelOf = (k: string) => {
      if (k === '') return T(fold === 'group' ? 'ungrouped' : 'uncategorized');
      if (fold === 'month') return k.replace('-', '. ');
      if (fold === 'payer') return who(k);
      return k;
    };

    const order: string[] = [];
    const bag = new Map<string, typeof list>();
    for (const e of list) {
      const k = keyOf(e);
      if (!bag.has(k)) {
        bag.set(k, []);
        order.push(k);
      }
      bag.get(k)?.push(e);
    }
    /* 이름 없는 덩어리('묶음 없음')는 언제나 맨 아래다. 이름이 붙은 것이
       읽는 사람이 찾는 것이고, 안 붙은 것은 나머지다. */
    order.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : 0));
    return order.map((k) => ({ key: k, label: labelOf(k), items: bag.get(k) ?? [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, fold, lang, ledger.members]);

  /** 쉬프트를 누른 채 누르면 마지막으로 고른 줄과 이번 줄 사이가 한꺼번에 처리된다. */
  function pick(id: string, on: boolean, withShift: boolean) {
    const next = new Set(selection);
    const at = pickable.indexOf(id);

    if (withShift && lastPicked !== null) {
      const from = pickable.indexOf(lastPicked);
      if (from !== -1 && at !== -1) {
        for (let i = Math.min(from, at); i <= Math.max(from, at); i += 1) {
          if (on) next.add(pickable[i]);
          else next.delete(pickable[i]);
        }
      }
    } else if (on) next.add(id);
    else next.delete(id);

    setSelection(next);
    setLastPicked(id);
  }

  /**
   * 정산하기 (§12)
   *
   * 고른 것이 있으면 그것만, 없으면 **아직 정산 안 한 것 전부**를 닫는다.
   * 대개는 그날까지의 것을 다 닫으므로, 하나하나 고르게 하는 것은 매번
   * 같은 일을 시키는 것이다. 고르는 것은 일부만 닫고 싶을 때의 선택지다.
   *
   * 팀원이 혼자면 나눌 상대가 없어 그 자리에서 끝나고 장부도 닫힌다.
   * 그때는 정산 화면 대신 아카이브로 보낸다 — 볼 것이 그쪽에 있다.
   */
  async function settleThese(ids?: string[]) {
    setBusy(true);
    const r = await settle({ ledgerId: ledger.id, expenseIds: ids });
    setBusy(false);
    if (!r.ok) return say(r.message);
    setSelection(new Set());
    router.push(`/l/${ledger.id}/${r.value.archived ? 'archive' : 'settle'}`);
    router.refresh();
  }

  /**
   * 고른 줄들을 지운다.
   *
   * 고를 수 있는 줄(pickable)은 아직 정산에 안 들어간 줄뿐이라, 여기서
   * 지워도 확정된 정산이 흔들리지 않는다. 그래서 되묻는 말은 짧다 —
   * 몇 건이 사라지는지와, 되돌릴 수 없다는 것.
   *
   * 확인창을 쓰는 이유 — 되묻는 일이 단추 안에서 일어나면 무엇이 겨눠져
   * 있는지 색으로만 알게 된다. 여기서 사라지는 것은 여러 줄이라 몇 건인지를
   * 글로 말해야 한다.
   */
  async function dropSelected() {
    const ids = [...selection];
    if (ids.length === 0) return;
    if (!window.confirm(T('dropSelectedWarn', { n: ids.length }))) return;

    setBusy(true);
    const r = await deleteExpenses({ ledgerId: ledger.id, expenseIds: ids });
    setBusy(false);
    if (!r.ok) return say(r.message);

    setSelection(new Set());
    setOpenRow(null);
    setEditing(null);
    // 몇 건이 지워졌는지 말한다. 일부만 지워졌을 때 조용히 넘어가지 않으려고.
    say(T('droppedN', { n: r.value.removed }));
    router.refresh();
  }

  function sortBy(k: SortKey) {
    if (k === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setKey(k);
      setDir('asc');
    }
  }

  const arrow = (k: SortKey) => (key === k ? (dir === 'asc' ? ' ↑' : ' ↓') : '');
  const selectedTotal = ledger.expenses
    .filter((e) => selection.has(e.id))
    .reduce((a, e) => a + e.amount, 0);
  /** 아직 안 닫힌 것의 합. '전체 정산'이 무엇을 닫는지 미리 보여 준다. */
  const openTotal = ledger.expenses
    .filter((e) => pickable.includes(e.id))
    .reduce((a, e) => a + e.amount, 0);

  /**
   * 빈 장부.
   *
   * 여기에 '지출 기입' 단추를 한 번 더 두었었다. 그런데 그 단추는 바로 위
   * 차례표에 늘 붙어 있고, 폰에서는 화면 폭을 다 쓰는 검은 띠라 눈에 제일
   * 먼저 들어온다. 같은 단추가 한 화면에 둘이면 두 개가 다른 일을 하는 줄
   * 알고 한 번 멈춰 읽게 된다.
   *
   * 그래서 여기서는 단추를 지우고, 이 자리가 무엇을 담는 자리인지만 적는다.
   * 할 일은 위에 있고, 여기는 아직 비어 있다는 사실을 말하는 자리다.
   */
  if (ledger.expenses.length === 0) {
    return (
      <section>
        <div className="empty">
          <p className="empty-say">{T('bookEmpty')}</p>
          <p className="empty-how">{T('bookEmptyHow')}</p>
        </div>
      </section>
    );
  }

  const rows: React.ReactNode[] = [];
  let ci = 0;

  /**
   * 마감 줄. 장부의 한 구획이 여기서 닫힌다.
   *
   * 날짜는 왼쪽, 합계는 오른쪽 끝. 가운데 이름을 두고 양끝을 밀어 놓는 것이
   * 종이 장부의 마감선이 생긴 모양이다. 도장은 합계 옆에 찍힌다.
   */
  const closingRow = (s: Ledger['settlements'][number]) => (
    <tr className="closing" key={`c-${s.id}`}>
      <td colSpan={8}>
        <div className="close-line">
          <span className="num day">{s.date}</span>
          {/* 이름은 가운데. 이 줄은 기록이 아니라 구획을 닫는 표시라서,
              왼쪽에서 읽기 시작하는 다른 줄들과 다르게 앉힌다. */}
          <b>{T('closing', { label: s.label })}</b>
          <span className="close-sum">
            <span className="num total">{cash(s.snapshot.totalAmount)}</span>
            {/* 구획이 닫힌 것과 돈이 다 오간 것은 다른 사실이다.
                송금이 남아 있으면 도장 대신 몇 건이 남았는지 적는다. */}
            {openSeqs.includes(s.seq) ? (
              <span className="waiting">
                {T('waitingN', { n: s.snapshot.transfers.length })}
              </span>
            ) : (
              <span
                className="mark sm"
                aria-hidden="true"
                style={{ transform: `rotate(${-11 + ((s.seq * 7) % 9)}deg)` }}
              >
                <span className="big">{T('settledStamp')}</span>
              </span>
            )}
          </span>
        </div>
      </td>
    </tr>
  );

  for (const sec of sections) {
    if (fold !== 'none') {
      const folded = shut.has(sec.key);
      const subtotal = sec.items.reduce((a, x) => a + x.amount, 0);
      rows.push(
        /*
          덩어리의 머리.

          이름 · 건수 · 소계 셋을 한 줄에 둔다. 접어 놓은 채로도 소계는
          보여야 한다 — 접는 이유가 "안에 뭐가 있는지 말고 얼마인지만
          보고 싶다"이기 때문이다.
        */
        <tr className={`foldhead${folded ? ' shut' : ''}`} key={`h-${sec.key}`}>
          {/*
            소계는 **금액 칸 아래**에 선다.

            처음에는 머리 전체를 한 칸(colSpan 8)으로 두고 소계를 오른쪽 끝에
            붙였다. 그러면 소계가 '상태' 칸 아래에 서서, 위아래 숫자와 자릿수가
            맞지 않는다. 장부에서 세로로 늘어선 숫자가 어긋나 보이면 더할 수가
            없다 — 그게 표를 쓰는 이유다. 그래서 칸 구조를 그대로 따른다.
          */}
          <td className="tick" />
          <td colSpan={4}>
            <button
              type="button"
              className="foldbtn"
              aria-expanded={!folded}
              onClick={() =>
                setShut((prev) => {
                  const next = new Set(prev);
                  if (next.has(sec.key)) next.delete(sec.key);
                  else next.add(sec.key);
                  return next;
                })
              }
            >
              <span className="caret" aria-hidden="true">{folded ? '▸' : '▾'}</span>
              <span className="foldname">{sec.label}</span>
              <span className="muted foldn">{T('nOfM', { n: sec.items.length })}</span>
            </button>
          </td>
          <td className="r money foldsum">{entry(subtotal)}</td>
          <td colSpan={2} />
        </tr>,
      );
      if (folded) continue;
    }

  for (const e of sec.items) {
    while (ci < closings.length && closings[ci].date < e.date) {
      rows.push(closingRow(closings[ci]));
      ci += 1;
    }
    const done = settled.has(e.id);
    // 자기가 사서 자기가 가져간 줄은 정산할 것이 애초에 없다. '미정산'으로
    // 두면 정산해야 할 것이 남은 것처럼 보이는데, 정산을 눌러도 이 줄에서는
    // 아무 송금도 나오지 않는다.
    const nothingToSettle = !done && !needsSettling(e);
    // 글자를 더해 버리면 이웃한 id끼리 값이 1씩만 벌어져 도장이 다 비슷해진다.
    // 자리마다 무게를 달리 줘서 흩어 놓는다.
    const hash = [...e.id].reduce((a, c, i) => (a * 31 + c.charCodeAt(0) * (i + 7)) >>> 0, 17);

    /*
     * 'rest' — 손댈 것이 남지 않은 줄.
     *
     * 정산에 들어간 줄(done)만 회색으로 두었더니, 자기가 사서 자기가 가져간
     * 줄('정산 불필요')만 흰 종이 위에 혼자 남았다. 그 줄도 끝난 줄이다.
     * 정산을 기다리는 것이 아니라 애초에 정산할 것이 없는 것이라, 훑을 때
     * 걸릴 이유가 없다. 끝난 것끼리 같은 톤으로 둔다.
     *
     * 다만 정산 회차의 덩어리에 붙이지는 않는다. 그 줄은 그 정산에 들어간
     * 것이 아니므로, 줄 사이의 선은 남겨 둔다.
     */
    rows.push(
      <tr
        className={`entry${done ? ' done' : ''}${nothingToSettle ? ' rest' : ''}${
          openRow === e.id ? ' open' : ''
        }`}
        key={e.id}
      >
        <td className="tick">
          {!done && !nothingToSettle && (
            <input
              type="checkbox"
              checked={selection.has(e.id)}
              aria-label={T('selectRow')}
              onChange={(ev) =>
                pick(e.id, ev.target.checked, (ev.nativeEvent as MouseEvent).shiftKey)
              }
            />
          )}
        </td>
        <td className="slip">{slips.get(e.id)}</td>
        <td className="day">{e.date.slice(5).replace('-', '.')}</td>
        <td className="item">
          <button className="subject" onClick={() => setOpenRow(openRow === e.id ? null : e.id)}>
            {e.title}
          </button>
          {e.adjustment && <span className="tag">{adjustmentLabel(e, lang)}</span>}
        </td>
        <td className="muted whom">{who(e.payerId)}</td>
        {/* 빼는 금액은 괄호로 적는다. 빨간 마이너스는 반대로 읽힌다(money.ts). */}
        <td className="r money">{entry(e.amount)}</td>
        <td className="muted bears">{allocationLabel(e, ledger.members, lang)}</td>
        <td className="state">
          {nothingToSettle && <span className="muted">{T('noSettleNeeded')}</span>}
          {/* 정산에 들어갔지만 아직 송금이 안 끝난 줄. 닫힌 것은 맞으므로
              그렇게만 적고, 도장은 돈이 다 오간 뒤에 찍는다. */}
          {done && waiting(seqOf.get(e.id)) && (
            <span className="muted">{T('closedMark')}</span>
          )}
          {done && !waiting(seqOf.get(e.id)) && (
            <span
              className="done-mark"
              style={
                {
                  transform: `rotate(${-17 + (hash % 35)}deg) translate(${
                    -3 + ((hash >> 5) % 7)
                  }px, ${-2 + ((hash >> 9) % 5)}px)`,
                  '--press': (0.62 + ((hash >> 3) % 30) / 100).toFixed(2),
                  '--blot': `${(hash >> 7) % 90}px ${(hash >> 11) % 90}px`,
                } as React.CSSProperties
              }
            >
              {T('doneStamp')}
            </span>
          )}
        </td>
      </tr>,
    );

    if (openRow === e.id) {
      const shares = breakdownOf(e).shares;
      const adjustments = adjustmentsFor(ledger.expenses, e.id);
      const eff = effectiveAmount(ledger.expenses, e);

      rows.push(
        <tr className={`unfold${done ? ' done' : ''}`} key={`${e.id}-open`}>
          <td className="opened" colSpan={8}>
            <div style={{ padding: '18px 14px 22px' }}>
              <div className="fields" style={{ gap: 30 }}>
                {/* 이 줄이 무엇이었는지는 결국 영수증에 적혀 있다.
                    작게 붙여 두고, 누르면 읽을 수 있는 크기로 열린다.
                    여기서 올리고 바꾸고 뗄 수 있다. */}
                <div>
                  <div className="caption" style={{ marginBottom: 8 }}>{T('receipt')}</div>
                  <ImageField
                    ledgerId={ledger.id}
                    expenseId={e.id}
                    kind="receipt"
                    path={e.receiptImage}
                    alt={e.title}
                    caption={`${e.title} · ${cash(e.amount)} · ${e.date}`}
                    lang={lang}
                  />
                </div>

                {/* 산 물건이 무엇인지 보이는 사진. 품목 화면의 카드에 걸린다. */}
                <div>
                  <div className="caption" style={{ marginBottom: 8 }}>{T('itemPhoto')}</div>
                  <ImageField
                    ledgerId={ledger.id}
                    expenseId={e.id}
                    kind="item"
                    path={e.representativeImage}
                    alt={e.title}
                    caption={`${e.title} · ${cash(e.amount)} · ${e.date}`}
                    lang={lang}
                  />
                </div>

                <div>
                  <div className="caption" style={{ marginBottom: 8 }}>
                    {T('eachBears')}
                  </div>
                  <table className="tally" style={{ maxWidth: 250 }}>
                    <tbody>
                      {shares.map((s) => (
                        <tr key={s.memberId}>
                          <td className="l">{who(s.memberId)}</td>
                          <td className="v">
                            {cash(s.amount)}
                            {s.roundingAdjusted && <span className="faint"> (+1)</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/*
                  항목별 청구를 펼친 자리 (§10.4)

                  위의 '각자 부담'은 사람별 합계고, 여기는 그 합계가 어느
                  줄에서 나왔는지다. 배달 영수증 한 장에서 "내가 왜 만이천
                  원이지"의 답은 언제나 줄 안에 있다.
                */}
                {e.allocation.type === 'items' && (
                  <div>
                    <div className="caption" style={{ marginBottom: 8 }}>
                      {T('itemBreakdown')}
                    </div>
                    <table className="tally lines-read-out">
                      <tbody>
                        {lineSharesOf(e).map((row, i) => (
                          <tr key={`${row.line.name}-${i}`}>
                            <td className="l">{row.line.name}</td>
                            <td className="v">{cash(row.line.amount)}</td>
                            <td className="l faint">
                              {row.shares.map((s) => who(s.memberId)).join(' · ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div>
                  <table className="facts">
                    <tbody>
                      {e.originalCurrency && (
                        <tr>
                          <td className="k">{T('receiptAmount')}</td>
                          <td>
                            {formatMoney(e.originalAmount ?? 0, e.originalCurrency)}{' '}
                            <span className="faint">{e.originalCurrency}</span>
                          </td>
                        </tr>
                      )}
                      {e.vendor && (
                        <tr>
                          <td className="k">{T('vendor')}</td>
                          <td>{e.vendor}</td>
                        </tr>
                      )}
                      {e.category && (
                        <tr>
                          <td className="k">{T('category')}</td>
                          <td>{e.category}</td>
                        </tr>
                      )}
                      <tr>
                        <td className="k">{T('splitBasis')}</td>
                        <td>
                          {T('basisMembers', { n: e.teamMemberIds.length })}
                          <br />
                          <span className="faint">
                            {e.teamMemberIds.map((id) => who(id)).join(', ')}
                          </span>
                        </td>
                      </tr>
                      {adjustments.length > 0 && (
                        <tr>
                          <td className="k">{T('laterChanges')}</td>
                          <td>
                            {adjustments.map((a) => (
                              <span key={a.id}>
                                {adjustmentLabel(a, lang)} {cash(a.amount)}
                                <br />
                              </span>
                            ))}
                            <b>{T('actualAmount', { amount: cash(eff) })}</b>
                          </td>
                        </tr>
                      )}
                      {e.note && (
                        <tr>
                          <td className="k">{T('memo')}</td>
                          <td className="muted">{e.note}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 고치는 자리는 이 줄 안에서 열린다. 어느 줄을 고치는 중인지
                  눈에서 놓치지 않고, 고치면 바로 그 줄이 바뀌는 것이 보인다. */}
              {editing === e.id &&
                (done ? (
                  /* 정산이 끝난 줄에서는 이름표만 고친다. 분류를 나중에
                     바로잡는 일은 흔하고, 그건 계산과 아무 상관이 없다. */
                  <Relabel
                    ledgerId={ledger.id}
                    expense={e}
                    groups={groups}
                    lang={lang}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <EditExpense
                    ledgerId={ledger.id}
                    expense={e}
                    groups={groups}
                    fund={ledger.fundSource ?? 'each'}
                    members={ledger.members}
                    currency={ledger.currency ?? 'KRW'}
                    lang={lang}
                    onDone={() => setEditing(null)}
                  />
                ))}

              <div className="row" style={{ marginTop: 18, gap: 20 }}>
                {e.productLink && (
                  <a href={e.productLink} target="_blank" rel="noopener">
                    {T('seeStore')}
                  </a>
                )}

                {/*
                  고치는 자리.

                  정산 전에는 다 고친다. 정산 뒤에는 **이름표만** 고친다 —
                  항목 이름, 판매처, 분류, 메모. 금액과 날짜와 결제자와 부담
                  방식은 확정된 정산의 근거라서 건드리지 않는다. 그걸 바로잡는
                  길은 보정 항목이 따로 맡는다.

                  분류를 나중에 고치는 일은 흔하다. 학기가 끝나고 아카이브를
                  보면서 "이건 식비가 아니라 재료비였네" 하는 순간이 온다.
                  그때 장부가 굳어 있으면 남는 것은 틀린 기록이다.
                */}
                {editing !== e.id && (
                  <button className="plain" onClick={() => setEditing(e.id)}>
                    {/*
                      정산에 들어간 줄이든 아니든 **같은 말**이다.

                      전에는 정산된 줄에만 '카테고리·메모 수정'이라고 달리
                      적었다. 무엇이 고쳐지는지 미리 알려 주려던 것인데,
                      한 표 안에서 같은 자리의 단추가 줄마다 다른 말을 하니
                      두 가지 기능이 있는 것처럼 보였다. 실제로는 하나다 —
                      그 줄을 고치는 자리다.

                      무엇을 못 고치는지는 열고 나서 첫 줄이 말한다
                      (Relabel.tsx 의 relabelOnly). 고치려다 없는 것을 찾는
                      것보다, 열자마자 아는 편이 낫다.
                    */}
                    {T('editEntry')}
                  </button>
                )}

                {/*
                  없던 기록으로 만든다.

                  정산에 들어간 줄도 지울 수 있다. 그때는 그 정산이 통째로
                  걷어지고 나머지 지출은 미정산으로 돌아간다 — 정산이 반쯤
                  맞는 상태로 남지 않게 하려는 것이다. 이미 받았다고 확인된
                  송금이 있으면 서버가 막는다. 돈이 실제로 오간 것이라서.

                  되돌릴 수 없어서 한 번 더 묻는다. 창을 띄우지는 않는다.
                */}
                <DeleteExpense
                  ledgerId={ledger.id}
                  expenseId={e.id}
                  title={e.title}
                  settled={done}
                  lang={lang}
                />
              </div>
            </div>
          </td>
        </tr>,
      );
    }
  }
  }
  while (ci < closings.length) {
    rows.push(closingRow(closings[ci]));
    ci += 1;
  }

  const groupCount = groups.length;

  return (
    <section>

      {/*
        묶어 보는 기준 (§11.3)

        표 위에 둔다. 표 안에 두면 정렬 단추와 섞이는데, 정렬은 줄의 앞뒤를
        바꾸는 일이고 이것은 줄을 덩어리로 묶는 일이라 다른 종류다.

        '묶음' 기준은 묶음 이름이 하나라도 있을 때만 나온다. 아무것도 안
        붙였는데 그 기준이 서 있으면, 눌러 봐야 전부 '묶음 없음' 한 덩어리다.
      */}
      <div className="foldbar">
        <span className="lab">{T('foldBy')}</span>
        {(['none', ...(groupCount > 0 ? (['group'] as const) : []), 'month', 'category', 'payer'] as FoldKey[]).map(
          (f) => (
            <button
              key={f}
              type="button"
              className={`chip${fold === f ? ' on' : ''}`}
              aria-pressed={fold === f}
              onClick={() => {
                setFold(f);
                setShut(new Set());
              }}
            >
              {T(
                f === 'none'
                  ? 'foldNone'
                  : f === 'group'
                    ? 'foldGroup'
                    : f === 'month'
                      ? 'foldMonth'
                      : f === 'category'
                        ? 'foldCategory'
                        : 'foldPayer',
              )}
            </button>
          ),
        )}
        {fold !== 'none' && (
          <button
            type="button"
            className="plain foldall"
            onClick={() =>
              setShut((prev) =>
                prev.size > 0 ? new Set() : new Set(sections.map((x) => x.key)),
              )
            }
          >
            {shut.size > 0 ? T('unfoldAll') : T('foldAll')}
          </button>
        )}
      </div>

      <div className="scroll" style={{ marginTop: 14 }}>
        <table className="book entries">
          <thead>
            <tr>
              <th style={{ width: 24 }} />
              <th>{T('colNo')}</th>
              <th aria-sort={key === 'date' ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button className="sortbtn" onClick={() => sortBy('date')}>
                  {T('colDate')}{arrow('date')}
                </button>
              </th>
              <th>{T('colItem')}</th>
              <th>{T('colPayer')}</th>
              <th
                className="r money"
                aria-sort={key === 'amount' ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                <button className="sortbtn" onClick={() => sortBy('amount')}>
                  {T('colAmount')}{arrow('amount')}
                </button>
              </th>
              <th>{T('colBears')}</th>
              <th>{T('colState')}</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 20 }}>
        {/*
          전체 정산.

          고르는 일 없이 **아직 안 닫힌 것을 한 번에** 닫는다. 대개는 그날까지
          쓴 것을 다 닫으므로 이쪽이 기본이고, 줄을 고르는 것은 일부만 닫고
          싶을 때의 선택지다. 고르기 시작하면 이 단추는 물러난다 — 그때는
          '고른 것만'이 하려는 일이다.
        */}
        {selection.size === 0 && pickable.length > 0 && (
          <>
            <span className="muted">
              {T('openN', { n: pickable.length })}
              <span className="num" style={{ marginLeft: 12 }}>
                {cash(openTotal)}
              </span>
            </span>
            <button className="act small primary" onClick={() => settleThese()} disabled={busy}>
              {busy ? T('settling') : T('settleAll')}
            </button>
          </>
        )}

        {selection.size > 0 && (
          <>
            <span>
              {T('selectedN', { n: selection.size })}
              <span className="num" style={{ marginLeft: 12 }}>
                {cash(selectedTotal)}
              </span>
            </span>
            <button className="act small" onClick={() => settleThese([...selection])} disabled={busy}>
              {busy ? T('settling') : T('settleSelected')}
            </button>
            <button className="plain" onClick={dropSelected} disabled={busy}>
              {T('dropSelected')}
            </button>
            <button className="plain" onClick={() => setSelection(new Set())}>
              {T('clearSelection')}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
