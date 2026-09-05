'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { closeTerm, deleteIncome, recordIncome, setBudget } from '../../../actions/ledger.ts';
import { jotIncomeLine } from '../../../actions/receipt.ts';
import SayIt from '../../../SayIt.tsx';
import { translator } from '../../../../lib/i18n.ts';
import { memberWord } from '../../../../lib/labels.ts';
import { formatMoney, formatNumber, parseMoney } from '../../../../lib/domain/money.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';
import type { CurrencyCode, Locale } from '../../../../lib/domain/money.ts';
import type { DuesRow, FundBook } from '../../../../lib/domain/closing.ts';
import type { Burn } from '../../../../lib/domain/ahead.ts';
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
 *
 * ── 적는 문은 한 줄이다 (§12.2)
 *
 * 원래 이 화면에서 수입 한 건을 적으려면 칸 다섯 개를 만져야 했다. 이름,
 * 금액, 날짜, **갈래 드롭다운, 낸 사람 드롭다운.** 회비는 스무 명이 내면
 * 스무 번이고, 그 스무 번은 사람이 이미 아는 것을 기계에게 다시 알려 주는
 * 일이다. 그건 회계 담당자가 엑셀에서 하던 바로 그 일이라, 서비스를 바꿔도
 * 하는 일이 같으면 바꿀 이유가 없다.
 *
 * 그래서 **한 줄 칸이 앞문이고 다섯 칸짜리 폼은 고치는 자리로 접어 둔다.**
 * "현우 3월 회비 3만원" 하나면 갈래도 낸 사람도 날짜도 채워진다.
 * 사람은 사실만 말하고, 갈래·기준은 장부가 알아낸다.
 *
 * 채우기만 하고 저장은 하지 않는다 — 마지막으로 보는 것은 사람이다.
 * 지출 기입(§11.4)과 같은 규칙이고, 같은 규칙이어야 두 화면을 따로
 * 배우지 않는다.
 */

const KINDS: IncomeKind[] = ['dues', 'grant', 'donation', 'carryover'];

export default function IncomePanel({
  ledger,
  members,
  book,
  dues,
  perHead,
  guessed,
  spend,
  meId,
  today,
  lang,
}: {
  ledger: Ledger;
  members: Member[];
  book: FundBook;
  /** 회비를 걷는 장부일 때만 채워진다 */
  dues: DuesRow[];
  /** 미납을 세는 기준. 사람이 적었거나 장부가 알아낸 값이다. */
  perHead: number;
  /** 그 기준을 장부가 알아냈다면, 몇 명 중 몇 명이 그렇게 냈는지 */
  guessed: { times: number; of: number } | null;
  /** 예산과 집행률, 그리고 이 속도면 얼마나 가는지 (§14) */
  spend: Burn;
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

  /** 예산을 고치는 칸. 접혀 있다 — 대개 고칠 일이 없다. */
  const [fixing, setFixing] = useState(false);
  const [budget, setBudgetText] = useState(
    ledger.budget ? formatNumber(ledger.budget, ledger.currency ?? 'KRW', lang) : '',
  );

  /** 한 줄 칸 */
  const [line, setLine] = useState('');
  const [jotting, setJotting] = useState(false);
  /** 어느 칸을 장부가 채웠는지. 사람이 무엇을 확인해야 하는지 알아야 한다. */
  const [read, setRead] = useState<string[]>([]);

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
      setLine('');
      setRead([]);
      setOpen(false);
      router.refresh();
    });
  }

  /*
   * 한 줄로 적기 (§12.2)
   *
   * 저장하지 않는다. 칸을 채우고 폼을 펴 줄 뿐이다 — 갈래를 잘못 읽었을 때
   * 되돌릴 자리가 있어야 하고, 그 자리는 이미 있는 폼이다.
   *
   * 못 읽은 칸은 무엇이 비었는지 말한다. 짐작해서 채운 값은 확인할 방법이
   * 없어서 빈칸보다 나쁘다 (§7).
   */
  async function writeLine() {
    const text = line.trim();
    if (!text) return say(T('inJotEmpty'));

    say('');
    setJotting(true);
    const r = await jotIncomeLine({ ledgerId: ledger.id, text });
    setJotting(false);
    if (!r.ok) return say(r.message);

    const v = r.value;
    const filled: string[] = [];
    if (v.title) { setTitle(v.title); filled.push('title'); }
    if (v.amount) { setAmount(formatNumber(v.amount, currency, lang)); filled.push('amount'); }
    if (v.date) { setDate(v.date); filled.push('date'); }
    setKind(v.kind as IncomeKind);
    filled.push('kind');
    if (v.memberId) { setMemberId(v.memberId); filled.push('who'); }
    setRead(filled);
    setOpen(true);

    const what = v.missing
      .filter((m) => m === 'amount' || m === 'payer')
      .map((m) => (m === 'amount' ? T('jotMissAmount') : T('incomeWho')));
    say(what.length > 0 ? T('jotMissing', { what: what.join(', ') }) : T('jotFilled'));
  }

  /** 장부가 채운 칸에 붙는 표시. 지출 기입과 같은 표시여야 같은 뜻으로 읽힌다. */
  const fromAI = (f: string) =>
    read.includes(f) ? <span className="ai-mark">{T('fromAI')}</span> : null;

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

      {/*
        집행률 (§14)

        결산이 "얼마 남았나"라면 이것은 **"얼마나 갔나"**다. 같은 숫자를 두
        번 적는 것처럼 보이지만 다르다 — 결산은 잔고고, 이쪽은 예산 대비
        위치다. 예산을 안 적어 두었으면 둘이 같은 값이 되는데, 그때도 띠는
        뜻이 있다: 절반을 썼는지 다 썼는지는 잔고 숫자만으로는 안 보인다.

        띠 하나에 색을 다 쓰지 않는다. 넘겼을 때만 붉어진다.
      */}
      <div className="caption" style={{ marginTop: 34 }}>{T('ranTitle')}</div>
      <div className="ran">
        <div className="ran-bar" role="img"
          aria-label={`${Math.round(spend.ran * 100)}%`}>
          <i className={spend.ran > 1 ? 'over' : undefined}
            style={{ width: `${Math.min(100, Math.round(spend.ran * 100))}%` }} />
        </div>
        <p className="ran-say">
          <span className="num big">{Math.round(spend.ran * 100)}%</span>
          <span className="muted">
            {T('ranSpent')} <b className="num">{cash(spend.spent)}</b>
            {' · '}
            {T('budgetWord')} <b className="num">{cash(spend.budget)}</b>
            {/* 알아낸 값이면 어디서 나왔는지 적는다. 사람이 설정한 적 없는
                숫자가 말없이 기준 노릇을 하면 안 된다 (§12.2 와 같은 규칙). */}
            {!spend.told && <span className="faint"> · {T('budgetGuess')}</span>}
          </span>
          {!closed && (
            <button className="plain" onClick={() => setFixing(!fixing)}>{T('budgetFix')}</button>
          )}
        </p>

        {fixing && (
          <div className="fields" style={{ marginTop: 12 }}>
            <label className="field">
              <span className="lab">{T('budgetWord')}</span>
              <input type="text" inputMode="decimal" className="num" value={budget}
                placeholder={formatNumber(spend.budget, currency, lang)}
                onChange={(e) => setBudgetText(e.target.value)} />
            </label>
            <p className="aside" style={{ flexBasis: '100%', marginTop: 6 }}>{T('budgetFree')}</p>
            <div className="row" style={{ flexBasis: '100%', marginTop: 12 }}>
              <button className="act small primary" disabled={pending}
                onClick={() => start(async () => {
                  const n = parseMoney(budget, currency);
                  const r = await setBudget({ ledgerId: ledger.id, budget: n > 0 ? n : undefined });
                  if (!r.ok) return say(r.message);
                  setFixing(false);
                  router.refresh();
                })}>
                {pending ? T('working') : T('saveEdit')}
              </button>
              <button className="plain" onClick={() => setFixing(false)}>{T('close')}</button>
            </div>
          </div>
        )}

        {/*
          이 속도면 얼마나 가는가.

          말할 근거가 모자라면 weeksLeft 가 null 이고, 그때는 날짜 대신
          **언제쯤 말해 줄 수 있는지**를 적는다. 침묵보다 낫고 짐작보다 낫다.
        */}
        <p className="aside" style={{ marginTop: 12 }}>
          {spend.left < 0
            ? T('ranOver', { amount: cash(-spend.left) })
            : spend.weeksLeft !== null
              ? T('ranDry', { n: spend.weeksLeft, date: (spend.dryOn ?? '').slice(5).replace('-', '.') })
              : T('ranQuiet')}
        </p>
      </div>

      {/*
        넘길 돈은 설정이 아니라 사실이다 (§12.2)

        예전에는 팀 설정의 '회기 이월' 체크칸이 이 줄을 켜고 껐다. 그런데
        남은 돈이 있으면 넘길 돈이 있는 것이고, 그건 켜고 끌 일이 아니라
        잔고에서 그냥 나오는 숫자다. 넘길지 말지를 정하는 자리는 바로 아래
        '회기 닫기'이고, 그때는 이 금액이 눈앞에 있다.
      */}
      {book.left > 0 && (
        <p className="aside" style={{ marginTop: 14 }}>
          {T('carryNext')} — <b className="num">{cash(book.left)}</b>
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
      {/* 회기를 닫는 순간이 보고서를 뽑는 순간이다. 그 자리에 함께 둔다. */}
      <p style={{ marginTop: 12 }}>
        <a className="plain" href={`/l/${ledger.id}/report`}>{T('reportTab')}</a>
      </p>

      {/* ── 회비 납부 ────────────────────────────────────────────── */}
      {dues.length > 0 && (
        <>
          <div className="caption" style={{ marginTop: 34 }}>
            {T('duesBoard')}
            <span className="faint"> · {T('duesPerHead')} {cash(perHead)}</span>
          </div>
          {/*
            기준을 장부가 알아냈으면 그렇다고 적는다 (§12.2)

            사람이 설정한 적 없는 숫자가 말없이 기준 노릇을 하면, 미납이
            틀렸을 때 어디를 봐야 하는지 알 수가 없다. 몇 명 중 몇 명이
            그렇게 냈는지까지 적으면 눈으로 검산이 된다.
          */}
          {guessed && (
            <p className="aside" style={{ marginTop: 8, marginBottom: 14 }}>
              {T('duesGuessed', { times: guessed.times, of: guessed.of })}
            </p>
          )}
          <div className="scroll">
            <table className="book">
              <thead>
                <tr>
                  <th>{memberWord(lang, ledger.fundSource)}</th>
                  <th className="r">{T('duesPaid')}</th>
                  <th className="r">{T('duesShort')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dues.map((r) => (
                  <tr key={r.memberId} className={r.short > 0 ? 'owes' : undefined}>
                    <td>{who(r.memberId)}</td>
                    <td className="r num">{cash(r.paid)}</td>
                    {/* 다 낸 사람의 0은 적지 않는다. 빈칸이 곧 '다 냈다'다. */}
                    <td className="r num debit">{r.short > 0 ? cash(r.short) : ''}</td>
                    {/*
                      말 대신 써 주기 (§15.2)

                      모자란 사람 줄에만 선다. 다 낸 사람 옆에 회색 단추가
                      서 있으면, 누를 일 없는 단추를 표의 절반이 지고 있게 된다.
                    */}
                    <td className="r">
                      {r.short > 0 && !closed && (
                        <SayIt ledgerId={ledger.id} toMemberId={r.memberId}
                          toName={who(r.memberId)} why="dues" lang={lang} />
                      )}
                    </td>
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
      {!closed && (
        <div className="jot">
          <div className="caption">{T('incomeAdd')}</div>
          <div className="jot-row">
            <input
              type="text"
              value={line}
              placeholder={T('inJotPlace')}
              maxLength={300}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                // 한글 조합 중의 Enter 는 글자를 고르는 것이지 보내는 것이 아니다.
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                writeLine();
              }}
            />
            <button className="act" disabled={jotting} onClick={writeLine}>
              <span className={`swap${jotting ? ' on' : ''}`}>
                <span className="rest">{T('jotDo')}</span>
                <span className="wait">{T('jotDoing')}</span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 한 줄이 안 통할 때의 길. 접혀 있다가 필요할 때만 펴진다. */}
      {!closed && !open && (
        <p className="drop-out">
          <button className="plain" onClick={() => setOpen(true)}>
            {T('writeManually')}
          </button>
        </p>
      )}

      {!closed && open && (
        <div className="editline" style={{ marginTop: 18 }}>
          <div className="fields">
            <label className="field wide">
              <span className="lab">{T('itemName')}{fromAI('title')}</span>
              <input type="text" value={title} placeholder={kindWord(kind)}
                onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">{T('amount')}{fromAI('amount')}</span>
              <input type="text" inputMode="decimal" className="num" value={amount}
                onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">{T('date')}{fromAI('date')}</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">{T('incomeWhat')}{fromAI('kind')}</span>
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
                <span className="lab">{T('incomeWho')}{fromAI('who')}</span>
                <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                  {members.filter((m) => m.active !== false).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* 회비는 1인당 금액이 정해져 있다. 매번 타자를 칠 이유가 없다.
              적어 둔 값이 없어도 장부가 알아낸 값으로 제안한다. */}
          {kind === 'dues' && perHead > 0 && (
            <p className="recall" style={{ marginTop: 12 }}>
              <span>{T('duesPerHead')} {cash(perHead)}</span>
              <button type="button" className="plain"
                onClick={() => {
                  setAmount(formatNumber(perHead, currency, lang));
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
            <button className="plain" onClick={() => { setOpen(false); setRead([]); }}>
              {T('close')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
