import Link from 'next/link';
import { getLang } from '../../../lib/lang.ts';
import LedgerShell from './LedgerShell.tsx';
import { requireLedgerAccess } from '../../../lib/access.ts';
import { loadLedger, openTransfers } from '../../../lib/db/repo.ts';
import {
  byEntryOrder,
  nameOf,
  summarizeLedger,
  unsettledExpenses,
} from '../../../lib/domain/settlement.ts';
import { adjustmentLabel, allocationLabel } from '../../../lib/labels.ts';
import { fundBook, unpaid, usesFund, collectsDues } from '../../../lib/domain/closing.ts';
import { nudges } from '../../../lib/domain/nudge.ts';
import { translator } from '../../../lib/i18n.ts';
import { formatEntryAmount, formatMoney } from '../../../lib/domain/money.ts';
import Moving from './Moving.tsx';
import { amOwner, teamMembers } from '../../actions/teams.ts';

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

  const [ledger, open, roster, owner] = await Promise.all([
    loadLedger(ledgerId),
    openTransfers(ledgerId),
    teamMembers(ledgerId),
    amOwner(ledgerId),
  ]);
  // 보낼 곳을 바로 보여 주려면 받는 사람의 계좌가 필요하다.
  const acct = new Map(roster.map((m) => [m.id, { bank: m.bank, accountNo: m.accountNo }]));
  const s = summarizeLedger(ledger);
  /* 공금을 쓰는 장부에는 첫 화면에도 잔고가 서야 한다 (§12).
     "얼마 남았나"가 이 화면에 들어오는 사람의 첫 물음이기 때문이다. */
  const fund = usesFund(ledger) ? fundBook(ledger) : null;
  const owing = collectsDues(ledger) && ledger.duesPerHead ? unpaid(ledger, ledger.members) : [];
  /*
   * 장부가 먼저 말을 거는 자리 (§15)
   *
   * 미룬 것이 쌓였을 때만 한 줄이 뜬다. 할 말이 없으면 빈 배열이고, 그때는
   * 아무것도 안 그린다 — 조용한 것이 이 기능의 절반이다. 순수 함수라
   * 질의도 모델 호출도 없다.
   */
  const said = nudges(ledger, ledger.members, new Date().toISOString().slice(0, 10));
  const members = ledger.members;
  const T = translator(lang);
  const currency = ledger.currency ?? 'KRW';
  const won = (n: number) => formatMoney(n, currency, lang);
  // 빼는 금액은 괄호로 적는다. 빨간 마이너스는 반대로 읽힌다(money.ts).
  const entry = (n: number) => formatEntryAmount(n, currency, lang);

  const toMe = open.filter((t) => t.to_member_id === pass.memberId);
  const fromMe = open.filter((t) => t.from_member_id === pass.memberId);
  /* 나와 상관없는 송금. 소유자에게만 보인다 — 받는 사람이 끝내 확인하지 않아
     장부가 안 닫힐 때 대신 눌러 줄 수 있는 사람은 소유자뿐이다. */
  const others = open.filter(
    (t) => t.to_member_id !== pass.memberId && t.from_member_id !== pass.memberId,
  );
  const recent = [...ledger.expenses].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  const mine = s.pending.balances.find((b) => b.memberId === pass.memberId);
  const net = mine ? mine.netBalance : 0;
  /* 바로 위 칸의 금액(s.unsettledAmount)은 '정산할 것이 남은 줄'만 더한다.
     건수만 뺄셈으로 세면 그 아래 숫자가 위 금액과 다른 것을 세게 된다 —
     자기가 사서 자기가 가져간 줄이 금액 0으로 한 건 더 잡힌다. */
  const unsettledCount = unsettledExpenses(ledger).length;

  // 전표 번호. 장부의 각 줄은 번호로 참조된다.
  const slips = new Map<string, string>();
  [...ledger.expenses]
    .sort(byEntryOrder)
    .forEach((e, i) => slips.set(e.id, String(i + 1).padStart(3, '0')));

  return (
    <>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current=""
        lang={lang}
        signedIn={Boolean(pass.userId)}
        fund={ledger.fundSource ?? 'each'}
      />

      <main>

        {/* 미룬 것이 쌓였으면 여기서 한 번 말한다. 끄는 단추는 없다 —
            하면 사라지는 것이라, 끄는 단추는 할 일을 지우는 단추가 된다. */}
        {said.length > 0 && (
          <div className="nudge">
            {said.map((n) => (
              <p key={n.kind}>
                {n.kind === 'settle' ? (
                  <>
                    {T('nudgeSettle', { weeks: n.weeks, rows: n.rows, perHead: won(n.perHead) })}
                    {' '}
                    <Link href={`/l/${ledgerId}/settle`}>{T('tabSettle')}</Link>
                  </>
                ) : (
                  <>
                    {T('nudgeDues', { people: n.people, short: won(n.short) })}
                    {' '}
                    <Link href={`/l/${ledgerId}/income`}>{T('incomeTab')}</Link>
                  </>
                )}
              </p>
            ))}
          </div>
        )}

        <section>
          {/*
            공금 잔고 (§12)

            세 숫자 위에 한 줄로 선다. 아래 셋은 사람들 사이의 셈이고
            이것은 한 주머니의 셈이라, 같은 줄에 섞으면 서로 다른 종류의
            숫자가 나란히 서게 된다.
          */}
          {fund && (
            <div className="fundline">
              <span className="lab">{T('fundLeft')}</span>
              <strong className="num">{won(fund.left)}</strong>
              <span className="ways num faint">
                {won(fund.carriedIn)} + {won(fund.received)} − {won(fund.spent)}
              </span>
              {owing.length > 0 && (
                <span className="debit">{T('duesUnpaidN', { n: owing.length })}</span>
              )}
              {ledger.closedAt && <span className="muted">{T('closedMarkTerm')}</span>}
            </div>
          )}

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
              memberId: t.from_member_id,
              who: nameOf(members, t.from_member_id),
              amount: t.amount,
              sent: Boolean(t.sent_at),
              sentAt: t.sent_at,
              bank: '',
              accountNo: '',
            }))}
            fromMe={fromMe.map((t) => ({
              transferId: t.transfer_id,
              who: nameOf(members, t.to_member_id),
              amount: t.amount,
              sent: Boolean(t.sent_at),
              sentAt: t.sent_at,
              bank: acct.get(t.to_member_id)?.bank ?? '',
              accountNo: acct.get(t.to_member_id)?.accountNo ?? '',
            }))}
            others={others.map((t) => ({
              transferId: t.transfer_id,
              who: `${nameOf(members, t.from_member_id)} → ${nameOf(members, t.to_member_id)}`,
              amount: t.amount,
              sent: Boolean(t.sent_at),
              sentAt: t.sent_at,
              bank: '',
              accountNo: '',
            }))}
            owner={owner}
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
              {/* 단추는 차례표에 늘 있다. 여기서 한 번 더 내밀지 않는다. */}
              <p className="empty-say">{T('bookEmpty')}</p>
              <p className="empty-how">{T('bookEmptyHow')}</p>
            </div>
          ) : (
          <div className="scroll">
            {/* 장부 화면의 표와 같은 이름을 준다. 좁은 화면에서 칸을 접는
                규칙이 이 이름에 걸려 있다 — 이름이 없어서 여섯 칸이 그대로
                밀려 들어와 이름이 한 글자씩 세로로 쪼개졌다. */}
            <table className="book entries">
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id} className="entry">
                    <td className="slip">{slips.get(e.id)}</td>
                    <td className="day">{e.date.slice(5).replace('-', '.')}</td>
                    <td className="item">
                      {e.title}
                      {e.adjustment && <span className="tag">{adjustmentLabel(e, lang)}</span>}
                    </td>
                    <td className="muted whom">{nameOf(members, e.payerId)}</td>
                    <td className="r money">{entry(e.amount)}</td>
                    <td className="muted bears">{allocationLabel(e, members, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </section>

        {/*
          결산 보고서 (§15.3)

          탭 줄에 넣지 않는다. 한 학기에 한두 번 쓰는 것이라 늘 서 있을
          자리는 아니고, 탭이 하나 늘면 매일 쓰는 다섯이 그만큼 좁아진다.
          장부 맨 아래, 다 훑고 나서 닿는 자리가 맞다.
        */}
        <div className="report-out">
          <Link href={`/l/${ledgerId}/report`} className="plain">{T('reportTab')}</Link>
          {/*
            내보내기 (§16)

            보고서 옆에 선다. 둘은 같은 자리에서 나가는 두 갈래다 —
            보고서는 사람이 읽는 종이고, CSV 는 기계가 읽는 것이다.

            Link 가 아니라 a 다. 화면으로 가는 것이 아니라 파일을 받는
            자리라서, 라우터가 가로채면 안 된다.
          */}
          <a href={`/l/${ledgerId}/export`} className="plain" download>{T('exportRows')}</a>
          {fund && (
            <a href={`/l/${ledgerId}/export?what=incomes`} className="plain" download>
              {T('exportIn')}
            </a>
          )}
        </div>
      </main>
    </>
  );
}
