'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { closeTerm, deleteIncome, recordIncome } from '../../../actions/ledger.ts';
import { translator } from '../../../../lib/i18n.ts';
import { memberWord } from '../../../../lib/labels.ts';
import { formatMoney, formatNumber, parseMoney } from '../../../../lib/domain/money.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';
import type { CurrencyCode, Locale } from '../../../../lib/domain/money.ts';
import type { DuesRow, FundBook } from '../../../../lib/domain/closing.ts';
import type { Income, IncomeKind, Ledger, Member } from '../../../../lib/domain/types.ts';

/**
 * 들어온 돈과 결산 (§12)
 *
 * 장부는 들어온 것과 나간 것이 둘 다 있고 잔고가 나오는 것이다. 지금까지
 * 이 서비스는 나간 것만 적었고, 이 화면이 나머지 절반이다.
 *
 * ── 결산이 맨 위에 선다
 *
 * 이 화면에 들어오는 사람이 알고 싶은 것은 대개 하나다 — **얼마 남았나.**
 * 목록은 그 숫자가 어디서 나왔는지 되짚을 때 본다. 그래서 잔고가 먼저고
 * 목록이 나중이다.
 *
 * 그리고 잔고 옆에 식을 그대로 적는다. "164,000원"만 있으면 믿을 근거가
 * 없지만 "47,000 + 275,000 − 158,000"이 함께 있으면 눈으로 검산이 된다.
 * (§23.3 계산은 숨기지 않는다)
 *
 * ── 미납은 참·거짓이 아니라 모자란 금액이다
 *
 * 반만 낸 사람이 안 낸 사람과 같은 칸에 서면 독촉할 말이 틀려진다.
 */

const KINDS: IncomeKind[] = ['dues', 'grant', 'donation', 'carryover'];

export default function IncomePanel({
  ledger,
  members,
  book,
  dues,
  meId,
  today,
  lang,
}: {
  ledger: Ledger;
  members: Member[];
  book: FundBook;
  /** 회비를 걷는 장부일 때만 채워진다 */
  dues: DuesRow[];
  meId: string;
  today: string;
  lang: Locale;
}) {
  const T = translator(lang);
  const router = useRouter();
  const { say } = useHelper();
  const [pending, start] = useTransition();

  const currency: CurrencyCode = ledger.currency ?? 'KRW';
  const cash = (n: number) => formatMoney(n, currency, lang);
  const who = (id?: string) => members.find((m) => m.id === id)?.name ?? '';
  const closed = Boolean(ledger.closedAt);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<IncomeKind>(ledger.fundSource === 'dues' ? 'dues' : 'grant');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [memberId, setMemberId] = useState(meId);

  const kindWord = (k: IncomeKind) =>
    T(k === 'dues' ? 'kindDues' : k === 'grant' ? 'kindGrant' : k === 'donation' ? 'kindDonation' : 'kindCarryover');

  function save() {
    const money = parseMoney(amount, currency);
    start(async () => {
      const r = await recordIncome({
        ledgerId: ledger.id,
        date,
        title: title.trim(),
        amount: money,
        kind,
        memberId: kind === 'dues' ? memberId : undefined,
      });
      if (!r.ok) return say(r.message);
      setTitle('');
      setAmount('');
      setOpen(false);
      router.refresh();
    });
  }

  function drop(income: Income) {
    start(async () => {
      const r = await deleteIncome({ ledgerId: ledger.id, incomeId: income.id });
      if (!r.ok) return say(r.message);
      router.refresh();
    });
  }

  return (
    <section>
      {/*
        결산. 남은 돈 하나가 제일 크고, 그 밑에 식이 그대로 선다 —
        숫자만 있으면 믿을 근거가 없다.
      */}
      <div className="caption">{T('fundBook')}</div>
      <div className="fundsum">
        <span className="lab">{T('fundLeft')}</span>
        <strong className="num big">{cash(book.left)}</strong>
        <span className="ways num">
          {cash(book.carriedIn)} + {cash(book.received)} − {cash(book.spent)}
        </span>
      </div>
      <table className="facts fundways">
        <tbody>
          <tr><td className="k">{T('fundCarried')}</td><td className="num r">{cash(book.carriedIn)}</td></tr>
          <tr><td className="k">{T('fundIn')}</td><td className="num r">{cash(book.received)}</td></tr>
          {/* 빼는 돈은 빼기표를 앞에 세운다. 붙임표(-)는 이 서비스에서 쓰지 않는다 —
              위의 식과 같은 글자여야 한 눈에 같은 뜻으로 읽힌다. */}
          <tr><td className="k">{T('fundOut')}</td><td className="num r">−{cash(book.spent)}</td></tr>
        </tbody>
      </table>

      {ledger.termCarry && (
        <p className="aside" style={{ marginTop: 14 }}>
          {T('carryNext')} — <b className="num">{cash(Math.max(0, book.left))}</b>
        </p>
      )}

      {/* 회기 닫기. 정산의 확정과 같은 성격이라 되돌릴 수 있게 둔다. */}
      <div className="row" style={{ marginTop: 18 }}>
        {closed ? (
          <>
            <span className="muted">{T('closedMarkTerm')}</span>
            <button className="plain" disabled={pending}
              onClick={() => start(async () => {
                const r = await closeTerm({ ledgerId: ledger.id, closed: false });
                if (!r.ok) return say(r.message);
                router.refresh();
              })}>
              {T('reopenTerm')}
            </button>
          </>
        ) : (
          <button className="act small" disabled={pending}
            onClick={() => start(async () => {
              const r = await closeTerm({ ledgerId: ledger.id, closed: true });
              if (!r.ok) return say(r.message);
              say(T('closeDone'));
              router.refresh();
            })}>
            {T('closeTerm')}
          </button>
        )}
        {!closed && <span className="faint">{T('closeWarn')}</span>}
      </div>

      {/* ── 회비 납부 ────────────────────────────────────────────── */}
      {dues.length > 0 && (
        <>
          <div className="caption" style={{ marginTop: 34 }}>
            {T('duesBoard')}
            <span className="faint"> · {T('duesPerHead')} {cash(ledger.duesPerHead ?? 0)}</span>
          </div>
          <div className="scroll">
            <table className="book">
              <thead>
                <tr>
                  <th>{memberWord(lang, ledger.fundSource)}</th>
                  <th className="r">{T('duesPaid')}</th>
                  <th className="r">{T('duesShort')}</th>
                </tr>
              </thead>
              <tbody>
                {dues.map((r) => (
                  <tr key={r.memberId} className={r.short > 0 ? 'owes' : undefined}>
                    <td>{who(r.memberId)}</td>
                    <td className="r num">{cash(r.paid)}</td>
                    {/* 다 낸 사람의 0은 적지 않는다. 빈칸이 곧 '다 냈다'다. */}
                    <td className="r num debit">{r.short > 0 ? cash(r.short) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="aside" style={{ marginTop: 10 }}>
            {dues.every((r) => r.short === 0)
              ? T('duesAllIn')
              : T('duesUnpaidN', { n: dues.filter((r) => r.short > 0).length })}
          </p>
        </>
      )}

      {/* ── 들어온 돈 ────────────────────────────────────────────── */}
      <div className="caption" style={{ marginTop: 34 }}>{T('incomeTab')}</div>

      {ledger.incomes.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}>
          <p>{T('incomeNone')}</p>
          <p className="faint">{T('incomeNoneHow')}</p>
        </div>
      ) : (
        <div className="scroll">
          <table className="book">
            <thead>
              <tr>
                <th>{T('colDate')}</th>
                <th>{T('itemName')}</th>
                <th>{T('incomeWhat')}</th>
                <th className="r">{T('amount')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ledger.incomes.map((i) => (
                <tr key={i.id}>
                  <td className="muted">{i.date.slice(5).replace('-', '.')}</td>
                  <td>
                    {i.title}
                    {i.memberId && <span className="faint"> · {who(i.memberId)}</span>}
                  </td>
                  <td className="muted">{kindWord(i.kind)}</td>
                  <td className="r num credit">{cash(i.amount)}</td>
                  <td className="r">
                    {!closed && (
                      <button className="line-drop" disabled={pending}
                        aria-label={T('deleteEntry')} title={T('deleteEntry')}
                        onClick={() => drop(i)}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 적는 자리 ────────────────────────────────────────────── */}
      {!closed && !open && (
        <p style={{ marginTop: 18 }}>
          <button className="act small primary" onClick={() => setOpen(true)}>
            {T('incomeAdd')}
          </button>
        </p>
      )}

      {!closed && open && (
        <div className="editline" style={{ marginTop: 18 }}>
          <div className="fields">
            <label className="field wide">
              <span className="lab">{T('itemName')}</span>
              <input type="text" value={title} placeholder={kindWord(kind)}
                onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">{T('amount')}</span>
              <input type="text" inputMode="decimal" className="num" value={amount}
                onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">{T('date')}</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">{T('incomeWhat')}</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as IncomeKind)}>
                {KINDS
                  // 회비를 안 걷는 장부에는 회비 갈래가 없다.
                  .filter((k) => k !== 'dues' || ledger.fundSource === 'dues')
                  .map((k) => (
                    <option key={k} value={k}>{kindWord(k)}</option>
                  ))}
              </select>
            </label>
            {kind === 'dues' && (
              <label className="field">
                <span className="lab">{T('incomeWho')}</span>
                <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                  {members.filter((m) => m.active !== false).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* 회비는 1인당 금액이 정해져 있다. 매번 타자를 칠 이유가 없다. */}
          {kind === 'dues' && ledger.duesPerHead && (
            <p className="recall" style={{ marginTop: 12 }}>
              <span>{T('duesPerHead')} {cash(ledger.duesPerHead)}</span>
              <button type="button" className="plain"
                onClick={() => {
                  setAmount(formatNumber(ledger.duesPerHead ?? 0, currency, lang));
                  if (!title.trim()) setTitle(T('kindDues'));
                }}>
                {T('recallUse')}
              </button>
            </p>
          )}

          <div className="row" style={{ marginTop: 18 }}>
            <button className="act small primary" disabled={pending} onClick={save}>
              {pending ? T('working') : T('incomeAdd')}
            </button>
            <button className="plain" onClick={() => setOpen(false)}>{T('close')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
