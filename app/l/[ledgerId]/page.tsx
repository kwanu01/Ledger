import Link from 'next/link';
import { getLang } from '../../../lib/lang.ts';
import LedgerShell from './LedgerShell.tsx';
import { requireLedgerAccess } from '../../../lib/access.ts';
import { loadLedger, openTransfers } from '../../../lib/db/repo.ts';
import { nameOf, settledExpenseIds, summarizeLedger } from '../../../lib/domain/settlement.ts';
import { adjustmentLabel, allocationLabel } from '../../../lib/labels.ts';
import { translator } from '../../../lib/i18n.ts';
import { formatEntryAmount, formatMoney, formatNumber } from '../../../lib/domain/money.ts';
import Moving from './Moving.tsx';
import { teamMembers } from '../../actions/teams.ts';

/**
 * 장부 홈 (§6, §21.2)
 *
 * 맨 위 세 칸이 전부다. 전체 얼마 썼나, 아직 정산 안 한 게 얼마나, 내 몫은 얼마.
 * 카드가 아니라 세로 괘선으로만 나눈다. 장부의 칸이지 대시보드의 타일이 아니다.
 */
export default async function LedgerHome({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();

  const [ledger, open, roster] = await Promise.all([
    loadLedger(ledgerId),
    openTransfers(ledgerId),
    teamMembers(ledgerId),
  ]);
  // 보낼 곳을 바로 보여 주려면 받는 사람의 계좌가 필요하다.
  const acct = new Map(roster.map((m) => [m.id, { bank: m.bank, accountNo: m.accountNo }]));
  const s = summarizeLedger(ledger);
  const members = ledger.members;
  const T = translator(lang);
  const currency = ledger.currency ?? 'KRW';
  const won = (n: number) => formatMoney(n, currency, lang);
  const won0 = (n: number) => formatNumber(n, currency, lang);
  // 빼는 금액은 괄호로 적는다. 빨간 마이너스는 반대로 읽힌다(money.ts).
  const entry = (n: number) => formatEntryAmount(n, currency, lang);

  const toMe = open.filter((t) => t.to_member_id === pass.memberId);
  const fromMe = open.filter((t) => t.from_member_id === pass.memberId);
  const recent = [...ledger.expenses].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  const mine = s.pending.balances.find((b) => b.memberId === pass.memberId);
  const net = mine ? mine.netBalance : 0;
  const unsettledCount = ledger.expenses.length - settledExpenseIds(ledger).size;

  // 전표 번호. 장부의 각 줄은 번호로 참조된다.
  const slips = new Map<string, string>();
  [...ledger.expenses]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1))
    .forEach((e, i) => slips.set(e.id, String(i + 1).padStart(3, '0')));

  return (
    <main>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current=""
        lang={lang}
        signedIn={Boolean(pass.userId)}
      />

      <section>
        <div className="summary">
          <div>
            <div className="label">{T('spentAll')}</div>
            <div className="figure">{won(s.totalSpent)}</div>
            <div className="under">{T('entries', { n: s.expenseCount })}</div>
          </div>
          <div>
            <div className="label">{T('notSettled')}</div>
            <div className="figure">{won(s.unsettledAmount)}</div>
            <div className="under">{T('countN', { n: unsettledCount })}</div>
          </div>
          <div>
            <div className="label">{T('myShare')}</div>
            {/* 0일 때도 숫자를 그대로 둔다. 장부에서 맞아떨어진 칸은 0으로 적지 다른 말을 쓰지 않는다. */}
            <div className={`figure${net < 0 ? ' debit' : ''}`}>
              {net === 0 ? won(0) : `${net > 0 ? '+' : '−'}${won(Math.abs(net))}`}
            </div>
            <div className="under">
              {net === 0 ? T('evenNothing') : net > 0 ? T('willReceive') : T('willSend')}
            </div>
          </div>
        </div>

        {/* 두 줄을 나란히 두면 합이 왜 갈라지는지 스스로 보인다. 설명 문장은 두지 않는다. */}
        <table className="facts" style={{ marginTop: 20 }}>
          <tbody>
            <tr>
              <td className="k">{T('sharedCost')}</td>
              <td className="v">{won(s.sharedTotal)}</td>
            </tr>
            <tr>
              <td className="k">{T('personalCost')}</td>
              <td className="v">{won(s.personalTotal)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <div className="caption">{T('moneyMoving')}</div>
        <Moving
          ledgerId={ledgerId}
          toMe={toMe.map((t) => ({
            transferId: t.transfer_id,
            who: nameOf(members, t.from_member_id),
            amount: t.amount,
            sent: Boolean(t.sent_at),
            bank: '',
            accountNo: '',
          }))}
          fromMe={fromMe.map((t) => ({
            transferId: t.transfer_id,
            who: nameOf(members, t.to_member_id),
            amount: t.amount,
            sent: Boolean(t.sent_at),
            bank: acct.get(t.to_member_id)?.bank ?? '',
            accountNo: acct.get(t.to_member_id)?.accountNo ?? '',
          }))}
          currency={currency}
          lang={lang}
        />
      </section>

      <section>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="caption">{T('recent')}</div>
          {ledger.expenses.length > 0 && (
            <Link href={`/l/${ledgerId}/book`} className="plain">
              {T('seeWholeBook')}
            </Link>
          )}
        </div>

        {ledger.expenses.length === 0 ? (
          <div className="empty">
            <Link href={`/l/${ledgerId}/add`} className="act primary">
              {T('addExpense')}
            </Link>
          </div>
        ) : (
        <div className="scroll">
          <table className="book">
            <tbody>
              {recent.map((e) => (
                <tr key={e.id} className="entry">
                  <td className="slip">{slips.get(e.id)}</td>
                  <td className="day">{e.date.slice(5).replace('-', '.')}</td>
                  <td>
                    {e.title}
                    {e.adjustment && <span className="tag">{adjustmentLabel(e, lang)}</span>}
                  </td>
                  <td className="muted">{nameOf(members, e.payerId)}</td>
                  <td className="r money">{entry(e.amount)}</td>
                  <td className="muted">{allocationLabel(e, members, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>
    </main>
  );
}
