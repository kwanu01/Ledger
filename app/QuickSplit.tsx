'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import LangPicker from './Prefs.tsx';
import ShareButton from './ShareButton.tsx';
import { CURRENCY_FOR, t } from '../lib/i18n.ts';
import { computeSettlement, splitEvenly } from '../lib/domain/settlement.ts';
import { formatMoney, formatNumber, parseMoney } from '../lib/domain/money.ts';
import type { Expense, Member } from '../lib/domain/types.ts';
import type { Locale } from '../lib/domain/money.ts';

/**
 * 첫 화면과 빠른 N빵 (§5.1)
 *
 * 열었을 때 보이는 것은 두 갈래뿐이다. 한쪽은 가입 없이 바로 계산하고,
 * 한쪽은 로그인해서 팀 기록으로 들어간다. 그 사이에 설명 문장은 없다.
 *
 * 계산은 팀 장부와 똑같은 엔진을 쓴다. 검산이 두 벌이 되면 그때부터 신뢰가 깨진다.
 */

type Payer = { name: string; amount: number };

export default function QuickSplit({
  signedIn = false,
  ledgerCount = 0,
  locale,
}: {
  signedIn?: boolean;
  ledgerCount?: number;
  locale: Locale;
}) {
  const [total, setTotal] = useState(0);
  const [people, setPeople] = useState(4);
  const [detailed, setDetailed] = useState(false);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [openProof, setOpenProof] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  // 통화는 고른 언어를 따른다. 장부의 통화는 장부를 만들 때 따로 고른다.
  const currency = CURRENCY_FOR[locale];
  const cash = (n: number) => formatMoney(n, currency, locale);
  const num = (n: number) => formatNumber(n, currency, locale);
  const parse = (v: string) => parseMoney(v, currency);
  const T = (k: Parameters<typeof t>[1], v?: Record<string, string | number>) => t(locale, k, v);

  const n = Math.max(1, people);
  const shares = total ? splitEvenly(total, Array.from({ length: n }, (_, i) => `p${i}`)) : [];
  const amounts = [...new Set(shares.map((s) => s.amount))];
  const oddCount = shares.filter((s) => s.roundingAdjusted).length;

  const detail = useMemo(() => {
    const members: Member[] = payers.map((p, i) => ({ id: `q${i}`, name: p.name || `이름 ${i + 1}` }));
    const ids = members.map((m) => m.id);
    const expenses: Expense[] = payers
      .map((p, i) => ({
        id: `qe${i}`,
        ledgerId: 'quick',
        date: '2026-01-01',
        title: `${p.name || `이름 ${i + 1}`} 결제`,
        amount: Math.round(p.amount),
        payerId: `q${i}`,
        teamMemberIds: ids,
        allocation: { type: 'all' as const },
        createdAt: '',
        createdBy: `q${i}`,
      }))
      .filter((e) => e.amount > 0);
    if (!expenses.length) return null;
    return { result: computeSettlement(expenses, members), members };
  }, [payers]);

  const who = (id: string) => detail?.members.find((m) => m.id === id)?.name ?? id;

  function openDetailed() {
    setDetailed(true);
    if (payers.length === 0) {
      setPayers(Array.from({ length: Math.max(2, n) }, () => ({ name: '', amount: 0 })));
    }
  }

  function setPayer(i: number, patch: Partial<Payer>) {
    setPayers((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  /** 빠른 N빵도 카카오톡으로 보낼 수 있어야 한다. 어느 채팅방에 보낼지는 카카오톡이 묻는다. */
  function kakaoMessage() {
    if (detail && detail.result.transfers.length) {
      return (
        '빠른 정산\n\n' +
        detail.result.transfers
          .map((t) => `${who(t.fromMemberId)} → ${who(t.toMemberId)}\n${cash(t.amount)}`)
          .join('\n\n') +
        `\n\n대상 금액\n${cash(detail.result.totalAmount)}`
      );
    }
    return (
      `빠른 정산\n\n${n}명\n한 사람당 ${cash(amounts[0] ?? 0)}` +
      (amounts.length > 1 ? ` 또는 ${cash(amounts[1])}` : '') +
      `\n\n총 금액\n${cash(total)}`
    );
  }

  // 갈림길 두 개. 한쪽은 가입 없이 바로 계산, 한쪽은 팀 기록.
  if (!open) {
    return (
      <div className="gate">
        <div className="choices">
          <button className="choice" onClick={() => setOpen(true)}>
            {T('split')}
            <span className="sub">{T('splitSub')}</span>
          </button>
          <Link className="choice" href={signedIn ? '/teams' : '/login'}>
            {T('team')}
            <span className="sub">
              {signedIn ? T('teamCount', { n: ledgerCount }) : T('teamNeedsLogin')}
            </span>
          </Link>
        </div>
        <div className="gate-foot">
          <LangPicker value={locale} />
        </div>
      </div>
    );
  }

  /* ── 각자 낸 금액 ───────────────────────────────────────────────────
     간단 계산과 섞어 두지 않는다. 총 금액을 적어 놓고 그 아래에서 각자 낸 돈을
     또 적으면 어느 쪽이 진짜인지 알 수 없다. 여기서는 낸 사람들만 적고,
     총 비용은 그 합으로 나온다. */
  if (detailed) {
    const spent = payers.reduce((a, p) => a + p.amount, 0);
    const heads = Math.max(1, payers.length);
    const evenly = spent ? splitEvenly(spent, payers.map((_, i) => `d${i}`)) : [];
    const per = [...new Set(evenly.map((x) => x.amount))];

    return (
      <div className="gate" style={{ paddingTop: 56 }}>
        <div className="result centered">
          <div className="label">{T('total')}</div>
          <div className={`each${spent ? '' : ' faint'}`}>{cash(spent)}</div>
          {spent > 0 && (
            <p className="note">
              {T('perPerson', {
                n: heads,
                amount: cash(per[0] ?? 0) + (per.length > 1 ? ` / ${cash(per[1])}` : ''),
              })}
            </p>
          )}
        </div>

        <div style={{ marginTop: 34 }}>
          <div className="caption">{T('whoPaid')}</div>

          <div className="scroll" style={{ marginTop: 10 }}>
            <table className="book">
              <tbody>
                {payers.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="text"
                        placeholder={T('name')}
                        value={p.name}
                        onChange={(e) => setPayer(i, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="num"
                        style={{ textAlign: 'right' }}
                        placeholder={T('paidAmount')}
                        defaultValue={p.amount ? num(p.amount) : ''}
                        onChange={(e) => setPayer(i, { amount: parse(e.target.value) })}
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {payers.length > 2 && (
                        <button
                          className="plain"
                          onClick={() => {
                            setPayers((prev) => prev.filter((_, j) => j !== i));
                            setOpenProof(null);
                          }}
                        >
                          {T('removePerson')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 12 }}>
            <button
              className="plain"
              onClick={() => setPayers((prev) => [...prev, { name: '', amount: 0 }])}
            >
              {T('addPerson')}
            </button>
          </p>
        </div>

        {detail && (
          <div style={{ marginTop: 34 }}>
            <div className="caption" style={{ marginBottom: 8 }}>
              {T('toSend')}
            </div>
            {detail.result.transfers.map((t, i) => (
              <div key={i}>
                <button
                  className="remit"
                  aria-expanded={openProof === i}
                  onClick={() => setOpenProof(openProof === i ? null : i)}
                >
                  <span className="who">
                    {who(t.fromMemberId)} → {who(t.toMemberId)}
                  </span>
                  <span className="sum">{cash(t.amount)}</span>
                  <span className="ask">{openProof === i ? T('hideWork') : T('showWork')}</span>
                </button>
                {openProof === i && (
                  <div className="proof">
                    <div className="proof-pair">
                      {[t.fromMemberId, t.toMemberId].map((id) => {
                        const b = detail.result.balances.find((x) => x.memberId === id)!;
                        const mine = detail.result.transfers.filter(
                          (x) => x.fromMemberId === id || x.toMemberId === id,
                        );
                        let running = b.totalPaid;
                        return (
                          <div key={id}>
                            <div className="caption" style={{ marginBottom: 10 }}>
                              {who(id)}
                            </div>
                            <table className="tally">
                              <tbody>
                                <tr>
                                  <td className="v">{num(b.totalPaid)}</td>
                                  <td className="l">{T('paid')}</td>
                                </tr>
                                {mine.map((x, j) => {
                                  const out = x.fromMemberId === id;
                                  running += out ? x.amount : -x.amount;
                                  return (
                                    <tr key={j} className={x === t ? 'hit' : undefined}>
                                      <td className="v">
                                        {out ? '+ ' : '− '}
                                        {num(x.amount)}
                                      </td>
                                      <td className="l">
                                        {out
                                          ? T('sentTo', { who: who(x.toMemberId) })
                                          : T('gotFrom', { who: who(x.fromMemberId) })}
                                      </td>
                                    </tr>
                                  );
                                })}
                                <tr className="close">
                                  <td className="v">{num(running)}</td>
                                  <td className="l">{T('sum')}</td>
                                </tr>
                                <tr>
                                  <td className="v faint">{num(b.totalOwed)}</td>
                                  <td className="l">{T('owed')}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 34, justifyContent: 'center', gap: 20 }}>
          {spent > 0 && <ShareButton text={kakaoMessage()} lang={locale} />}
          <button className="plain" onClick={() => setDetailed(false)}>
            {T('simpleSplit')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gate" style={{ paddingTop: 56 }}>
      <div className="calc-in">
        <label>
          {T('total')}
          <input
            type="text"
            inputMode="decimal"
            className="num"
            placeholder="0"
            defaultValue={total ? num(total) : ''}
            onChange={(e) => setTotal(parse(e.target.value))}
          />
        </label>
        <label>
          {T('people')}
          <input
            type="text"
            inputMode="numeric"
            className="num short"
            value={people || ''}
            onChange={(e) => setPeople(Math.max(1, Number(e.target.value.replace(/[^0-9]/g, '')) || 0))}
          />
        </label>
      </div>

      <div className="result centered">
        <div className="label">{T('each')}</div>
        <div className={`each${total ? '' : ' faint'}`}>{cash(total ? amounts[0] : 0)}</div>
        {/* 나머지가 생길 때만 말한다. 딱 나뉘면 아무 말도 필요 없다. */}
        {total > 0 && amounts.length > 1 && (
          <p className="note">{T('othersPay', { n: n - oddCount, amount: cash(amounts[1]) })}</p>
        )}
      </div>

      <p style={{ marginTop: 34, textAlign: 'center' }}>
        <button className="plain" onClick={openDetailed}>
          {T('enterEach')}
        </button>
      </p>

      {total > 0 && (
        <div className="row" style={{ marginTop: 34, justifyContent: 'center' }}>
          <ShareButton text={kakaoMessage()} lang={locale} />
        </div>
      )}
    </div>
  );
}
