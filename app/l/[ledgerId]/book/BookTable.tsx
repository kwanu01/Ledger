'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { settle } from '../../../actions/ledger.ts';
import {
  adjustmentsFor,
  breakdownOf,
  effectiveAmount,
  nameOf,
  settledExpenseIds,
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

/**
 * 장부 (§21.3)
 *
 * 한 줄이 한 건이고, 줄을 누르면 그 건이 어떻게 갈라졌는지 그 자리에서 펼쳐진다.
 * 정산이 끝난 줄에는 도장이 찍히고 더 이상 고를 수 없다.
 */

type SortKey = 'date' | 'amount';

export default function BookTable({ ledger, lang }: { ledger: Ledger; lang: Locale }) {
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
  const [busy, setBusy] = useState(false);

  const settled = useMemo(() => settledExpenseIds(ledger), [ledger]);

  // 전표 번호는 언제나 시간 순서로 매긴다. 정렬을 바꿔도 번호는 따라 움직이지 않는다.
  const slips = useMemo(() => {
    const map = new Map<string, string>();
    [...ledger.expenses]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1))
      .forEach((e, i) => map.set(e.id, String(i + 1).padStart(3, '0')));
    return map;
  }, [ledger]);

  const list = useMemo(() => {
    const chrono = [...ledger.expenses].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
    );
    if (key === 'amount') {
      const d = dir === 'asc' ? 1 : -1;
      return [...chrono].sort((a, b) => (a.amount - b.amount) * d);
    }
    return dir === 'asc' ? chrono : [...chrono].reverse();
  }, [ledger, key, dir]);

  // 마감선은 시간 순서 위에서만 뜻이 있다. 금액순으로 늘어놓으면 구획이 성립하지 않는다.
  const chronological = key === 'date' && dir === 'asc';
  const closings = chronological
    ? [...ledger.settlements].sort((a, b) => (a.date < b.date ? -1 : 1))
    : [];

  const pickable = list.filter((e) => !settled.has(e.id)).map((e) => e.id);

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

  async function settleSelected() {
        setBusy(true);
    const r = await settle({ ledgerId: ledger.id, expenseIds: [...selection] });
    setBusy(false);
    if (!r.ok) return say(r.message);
    setSelection(new Set());
    router.push(`/l/${ledger.id}/settle`);
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

  if (ledger.expenses.length === 0) {
    return (
      <section>
        <div className="empty">
          <a href={`/l/${ledger.id}/add`} className="act primary">
            {T('addExpense')}
          </a>
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
          <b>{T('closing', { label: s.label })}</b>
          <span className="num total">{cash(s.snapshot.totalAmount)}</span>
          <span
            className="mark sm"
            aria-hidden="true"
            style={{ transform: `rotate(${-11 + ((s.seq * 7) % 9)}deg)` }}
          >
            <span className="big">{T('settledStamp')}</span>
          </span>
        </div>
      </td>
    </tr>
  );

  for (const e of list) {
    while (ci < closings.length && closings[ci].date < e.date) {
      rows.push(closingRow(closings[ci]));
      ci += 1;
    }
    const done = settled.has(e.id);
    // 글자를 더해 버리면 이웃한 id끼리 값이 1씩만 벌어져 도장이 다 비슷해진다.
    // 자리마다 무게를 달리 줘서 흩어 놓는다.
    const hash = [...e.id].reduce((a, c, i) => (a * 31 + c.charCodeAt(0) * (i + 7)) >>> 0, 17);

    rows.push(
      <tr className={`entry${done ? ' done' : ''}${openRow === e.id ? ' open' : ''}`} key={e.id}>
        <td>
          {!done && (
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
        <td>
          <button className="subject" onClick={() => setOpenRow(openRow === e.id ? null : e.id)}>
            {e.title}
          </button>
          {e.adjustment && <span className="tag">{adjustmentLabel(e, lang)}</span>}
        </td>
        <td className="muted">{who(e.payerId)}</td>
        {/* 빼는 금액은 괄호로 적는다. 빨간 마이너스는 반대로 읽힌다(money.ts). */}
        <td className="r money">{entry(e.amount)}</td>
        <td className="muted">{allocationLabel(e, ledger.members, lang)}</td>
        <td>
          {done && (
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
        <tr key={`${e.id}-open`}>
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

              <div className="row" style={{ marginTop: 18, gap: 20 }}>
                {e.productLink && (
                  <a href={e.productLink} target="_blank" rel="noopener">
                    {T('seeStore')}
                  </a>
                )}

                {/*
                  잘못 적은 줄을 지운다.

                  정산에 들어간 줄에는 이 단추를 두지 않는다. 확정된 정산의
                  숫자가 나중에 흔들리면 안 되기 때문이다. 그때는 보정 항목을
                  새로 적는 길이 따로 있다 — 서버와 데이터베이스도 같이 막는다.

                  되돌릴 수 없어서 한 번 더 묻는다. 창을 띄우지는 않는다.
                */}
                {!settled.has(e.id) && (
                  <DeleteExpense
                    ledgerId={ledger.id}
                    expenseId={e.id}
                    title={e.title}
                    lang={lang}
                  />
                )}
              </div>
            </div>
          </td>
        </tr>,
      );
    }
  }
  while (ci < closings.length) {
    rows.push(closingRow(closings[ci]));
    ci += 1;
  }

  return (
    <section>

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
        {selection.size > 0 && (
          <>
            <span>
              {T('selectedN', { n: selection.size })}
              <span className="num" style={{ marginLeft: 12 }}>
                {cash(selectedTotal)}
              </span>
            </span>
            <button className="act small" onClick={settleSelected} disabled={busy}>
              {busy ? T('settling') : T('settleSelected')}
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
