import Link from 'next/link';
import { getLang } from '../../../../lib/lang.ts';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger } from '../../../../lib/db/repo.ts';
import { translator } from '../../../../lib/i18n.ts';
import { formatMoney } from '../../../../lib/domain/money.ts';
import { nameOf, breakdownOf } from '../../../../lib/domain/settlement.ts';
import {
  collectsDues,
  duesBoard,
  fromFund,
  fundBook,
  guessDuesPerHead,
  usesFund,
} from '../../../../lib/domain/closing.ts';
import { budgetOf } from '../../../../lib/domain/ahead.ts';
import PrintButton from './PrintButton.tsx';

/**
 * 결산 보고서 (§15.3)
 *
 * 교수, 학회, 총회에 내는 문서. 지금까지 이 데이터로 바로 나올 수 있었는데
 * 출구가 없었다 — 그래서 다들 화면을 보고 한글 파일에 옮겨 적었다.
 *
 * ── 모델을 부르지 않는다
 *
 * 설계 메모에는 "아무도 안 기다리는 자리라 큰 모델을 써도 되는 몇 안 되는
 * 곳"이라고 적혀 있었다. **안 쓰기로 한다.**
 *
 * 이 문서에 적히는 것은 전부 숫자거나 숫자에서 나온 문장이고, 이 서비스의
 * 첫 번째 규칙은 **돈을 나누는 숫자는 모델을 거치지 않는다**는 것이다.
 * 총평 한 문단쯤은 안전해 보이지만, "지출의 절반이 3월에 몰려 있습니다"도
 * 계산이 든 주장이다. 그리고 이 문서는 **교수와 총회 앞에 놓인다** — 이
 * 서비스가 내놓는 종이 중에 틀리면 가장 곤란한 것이 이것이다.
 *
 * 그래서 전부 순수 함수가 센 것만 적는다. 값도 안 들고, 즉시 나오고,
 * 무엇보다 **다시 뽑아도 같은 문서가 나온다.**
 *
 * ── PDF 를 만들지 않는다
 *
 * 브라우저의 인쇄가 이미 PDF 를 만든다. 서버에서 PDF 를 만들려면 무거운
 * 라이브러리와 글꼴 문제를 떠안아야 하고, 그렇게 만든 PDF 는 화면에 보이는
 * 것과 미묘하게 다른 물건이 된다. **보이는 것이 나오는 것**이 낫다.
 * 그래서 인쇄용 CSS 만 두고 단추 하나를 놓는다.
 *
 * ── 껍데기(LedgerShell)를 씌우지 않는다
 *
 * 문서다. 탭 줄과 팀 이름 머리글이 함께 인쇄되면 문서가 아니라 화면 캡처가
 * 된다. 돌아가는 길만 위에 한 줄 둔다.
 */
export default async function Report({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();
  const ledger = await loadLedger(ledgerId);

  const T = translator(lang);
  const currency = ledger.currency ?? 'KRW';
  const cash = (n: number) => formatMoney(n, currency, lang);
  const who = (id: string) => nameOf(ledger.members, id);
  const today = new Date().toISOString().slice(0, 10);

  const fund = usesFund(ledger);
  const book = fundBook(ledger);
  const { amount: budget, told } = budgetOf(ledger);

  /*
   * 기간은 적힌 것에서 나온다.
   *
   * 회기의 끝을 따로 적는 칸은 없다. 닫은 날이 있으면 그날이고, 아니면
   * 마지막으로 적힌 줄의 날짜다 — 없는 날짜를 지어내는 것보다 정확하다.
   */
  const dates = [
    ...ledger.expenses.map((e) => e.date),
    ...ledger.incomes.map((i) => i.date),
  ].sort();
  const from = ledger.startedAt;
  const to = ledger.closedAt?.slice(0, 10) ?? dates.at(-1) ?? today;

  /* 지출을 분류별로 묶는다. 분류가 없는 줄은 한 칸에 모은다 —
     '기타'라는 분류를 만들어 붙이면 사람이 적은 적 없는 분류가 문서에 남는다. */
  const spendRows = fund ? ledger.expenses.filter(fromFund) : ledger.expenses;
  const byCategory = new Map<string, { sum: number; n: number }>();
  for (const e of spendRows) {
    const k = e.category?.trim() || '';
    const at = byCategory.get(k) ?? { sum: 0, n: 0 };
    byCategory.set(k, { sum: at.sum + e.amount, n: at.n + 1 });
  }
  const cats = [...byCategory.entries()].sort((a, b) => b[1].sum - a[1].sum);
  const spent = spendRows.reduce((a, e) => a + e.amount, 0);

  const perHead = ledger.duesPerHead ?? guessDuesPerHead(ledger)?.amount ?? 0;
  const dues = collectsDues(ledger) && perHead > 0 ? duesBoard(ledger, ledger.members) : [];

  return (
    <main className="report">
      {/* 인쇄에는 안 나간다. 화면에서만 쓰는 두 줄이다. */}
      <p className="noprint back">
        <Link href={`/l/${ledgerId}`}>← {ledger.name}</Link>
        <PrintButton label={T('reportPrint')} />
      </p>

      <header className="rp-head">
        <h1>{T('reportTitle')}</h1>
        <p className="rp-who">
          {ledger.teamName} · {ledger.name}
        </p>
        <p className="rp-span">
          {T('reportSpan')} {from} — {to}
        </p>
      </header>

      {/* ── 결산 ─────────────────────────────────────────────────── */}
      {fund && (
        <section>
          <h2>{T('fundBook')}</h2>
          <table className="rp-table">
            <tbody>
              <tr><td>{T('fundCarried')}</td><td className="num r">{cash(book.carriedIn)}</td></tr>
              <tr><td>{T('fundIn')}</td><td className="num r">{cash(book.received)}</td></tr>
              <tr><td>{T('fundOut')}</td><td className="num r">−{cash(book.spent)}</td></tr>
              <tr className="sum">
                <td>{T('fundLeft')}</td><td className="num r">{cash(book.left)}</td>
              </tr>
            </tbody>
          </table>
          {/* 식을 그대로 적는다. 표만 있으면 검산하려고 계산기를 꺼내야 한다. */}
          <p className="rp-eq num">
            {cash(book.carriedIn)} + {cash(book.received)} − {cash(book.spent)} = {cash(book.left)}
          </p>
          <p className="rp-note">
            {T('budgetWord')} {cash(budget)}
            {!told && ` (${T('budgetGuess')})`}
            {budget > 0 && ` · ${T('ranTitle')} ${Math.round((book.spent / budget) * 100)}%`}
          </p>
        </section>
      )}

      {/* ── 들어온 돈 ────────────────────────────────────────────── */}
      {fund && (
        <section>
          <h2>{T('incomeTab')}</h2>
          {ledger.incomes.length === 0 ? (
            <p className="rp-note">{T('reportNoRows')}</p>
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{T('colDate')}</th><th>{T('itemName')}</th>
                  <th>{T('incomeWhat')}</th><th className="r">{T('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.incomes.map((i) => (
                  <tr key={i.id}>
                    <td className="num">{i.date}</td>
                    <td>
                      {i.title}
                      {i.memberId && <span className="rp-sub"> · {who(i.memberId)}</span>}
                    </td>
                    <td>
                      {T(i.kind === 'dues' ? 'kindDues'
                        : i.kind === 'grant' ? 'kindGrant'
                        : i.kind === 'donation' ? 'kindDonation' : 'kindCarryover')}
                    </td>
                    <td className="num r">{cash(i.amount)}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td colSpan={3}>{T('fundIn')}</td>
                  <td className="num r">{cash(book.carriedIn + book.received)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── 나간 돈 ──────────────────────────────────────────────── */}
      <section>
        <h2>{fund ? T('fundOut') : T('spentAll')}</h2>
        {cats.length > 0 && (
          <table className="rp-table rp-cats">
            <thead>
              <tr><th>{T('category')}</th><th className="r">{T('timesN', { n: '' })}</th><th className="r">{T('amount')}</th></tr>
            </thead>
            <tbody>
              {cats.map(([k, v]) => (
                <tr key={k || '—'}>
                  <td>{k || '—'}</td>
                  <td className="num r">{v.n}</td>
                  <td className="num r">{cash(v.sum)}</td>
                </tr>
              ))}
              <tr className="sum">
                <td>{T('sum')}</td>
                <td className="num r">{spendRows.length}</td>
                <td className="num r">{cash(spent)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {spendRows.length === 0 ? (
          <p className="rp-note">{T('reportNoRows')}</p>
        ) : (
          <table className="rp-table" style={{ marginTop: 18 }}>
            <thead>
              <tr>
                <th>{T('colDate')}</th><th>{T('itemName')}</th>
                <th>{T('payer')}</th><th className="r">{T('amount')}</th>
              </tr>
            </thead>
            <tbody>
              {[...spendRows].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => (
                <tr key={e.id}>
                  <td className="num">{e.date}</td>
                  <td>
                    {e.title}
                    {e.vendor && <span className="rp-sub"> · {e.vendor}</span>}
                  </td>
                  <td>{who(e.payerId)}</td>
                  <td className="num r">{cash(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── 회비 ─────────────────────────────────────────────────── */}
      {dues.length > 0 && (
        <section>
          <h2>{T('duesBoard')}</h2>
          <p className="rp-note">{T('duesPerHead')} {cash(perHead)}</p>
          <table className="rp-table">
            <thead>
              <tr>
                <th>{T('name')}</th>
                <th className="r">{T('duesPaid')}</th>
                <th className="r">{T('duesShort')}</th>
              </tr>
            </thead>
            <tbody>
              {dues.map((r) => (
                <tr key={r.memberId}>
                  <td>{who(r.memberId)}</td>
                  <td className="num r">{cash(r.paid)}</td>
                  <td className="num r">{r.short > 0 ? cash(r.short) : ''}</td>
                </tr>
              ))}
              <tr className="sum">
                <td>{T('sum')}</td>
                <td className="num r">{cash(dues.reduce((a, r) => a + r.paid, 0))}</td>
                <td className="num r">{cash(dues.reduce((a, r) => a + r.short, 0))}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {/* ── 정산 ─────────────────────────────────────────────────── */}
      {ledger.settlements.length > 0 && (
        <section>
          <h2>{T('settleHistory')}</h2>
          <table className="rp-table">
            <thead>
              <tr>
                <th>{T('colDate')}</th><th>{T('itemName')}</th>
                <th className="r">{T('openCount', { n: '' })}</th>
                <th className="r">{T('amount')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.settlements.map((st) => (
                <tr key={st.id}>
                  <td className="num">{st.date}</td>
                  <td>{st.label}</td>
                  <td className="num r">{st.snapshot.expenseIds.length}</td>
                  <td className="num r">{cash(st.snapshot.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/*
        각자 결제하는 장부에는 결산이 없다. 대신 사람마다 얼마를 내고
        얼마를 졌는지가 이 문서의 본문이 된다 — 그게 그 장부의 결산이다.
      */}
      {!fund && (
        <section>
          <h2>{T('settleCount')}</h2>
          <table className="rp-table">
            <thead>
              <tr>
                <th>{T('name')}</th>
                <th className="r">{T('paid')}</th>
                <th className="r">{T('owed')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.members.filter((m) => m.active !== false).map((m) => {
                const paid = ledger.expenses
                  .filter((e) => e.payerId === m.id)
                  .reduce((a, e) => a + e.amount, 0);
                const owed = ledger.expenses
                  .flatMap((e) => breakdownOf(e).shares)
                  .filter((sh) => sh.memberId === m.id)
                  .reduce((a, sh) => a + sh.amount, 0);
                return (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className="num r">{cash(paid)}</td>
                    <td className="num r">{cash(owed)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <div className="rp-foot">
        <p>{T('reportMade', { date: today })}</p>
        {/* 서명란. 총회에 내는 종이에는 이 줄이 있어야 한다. */}
        <p className="rp-sign">
          {T('reportSign')} {pass.memberName} <span className="rp-line" />
        </p>
      </div>
    </main>
  );
}
