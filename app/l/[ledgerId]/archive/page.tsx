import { getLang } from '../../../../lib/lang.ts';
import LedgerShell from '../LedgerShell.tsx';
import AdSlot from '../../../AdSlot.tsx';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger } from '../../../../lib/db/repo.ts';
import { summarizeLedger } from '../../../../lib/domain/settlement.ts';
import { formatMoney } from '../../../../lib/domain/money.ts';
import { translator } from '../../../../lib/i18n.ts';

/**
 * 아카이브 (§21.7, §31)
 *
 * 정산이 끝나면 장부는 계산기에서 기록으로 바뀐다. 이 화면이 그 마지막 모습이고,
 * 프로젝트가 끝난 뒤에도 남는다. 정산이 전부 끝난 장부에는 큰 도장이 찍힌다.
 */
export default async function Archive({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();
  const ledger = await loadLedger(ledgerId);
  const currency = ledger.currency ?? 'KRW';
  const cash = (n: number) => formatMoney(n, currency, lang);
  const T = translator(lang);

  const s = summarizeLedger(ledger);
  const dates = [...ledger.expenses].sort((a, b) => (a.date < b.date ? -1 : 1));

  const days = dates.length
    ? Math.round(
        (new Date(dates[dates.length - 1].date).getTime() - new Date(dates[0].date).getTime()) /
          86400000,
      ) + 1
    : 0;

  const cat = new Map<string, number>();
  for (const e of ledger.expenses) {
    const k = e.category || '기타';
    cat.set(k, (cat.get(k) ?? 0) + e.amount);
  }
  const sorted = [...cat.entries()].sort((a, b) => b[1] - a[1]);
  const peak = sorted.length ? sorted[0][1] : 1;

  const closed = s.unsettledAmount === 0 && ledger.settlements.length > 0;
  const last = ledger.settlements[ledger.settlements.length - 1];

  return (
    <main>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current="/archive"
        lang={lang}
        signedIn={Boolean(pass.userId)}
      />

      <section className={closed ? 'stamped' : undefined}>
        {closed && (
          <span
            className="mark lg"
            aria-hidden="true"
            style={{ right: 24, top: 2, transform: 'rotate(-13deg)' }}
          >
            <span className="big">{T('settledStamp')}</span>
            <span className="small">{last.date}</span>
          </span>
        )}

        <div className="caption">{T('archiveTitle')}</div>
        <h2 style={{ fontSize: 'clamp(23px,4vw,31px)', marginTop: 10 }}>{ledger.name}</h2>

        <table className="facts" style={{ marginTop: 22, minWidth: 340 }}>
          <tbody>
            <tr>
              <td className="k">{T('period')}</td>
              <td className="v">{T('days', { n: days })}</td>
            </tr>
            <tr>
              <td className="k">{T('recent')}</td>
              <td className="v">{T('countN', { n: s.expenseCount })}</td>
            </tr>
            <tr>
              <td className="k">{T('settleCount')}</td>
              <td className="v">{T('timesN', { n: ledger.settlements.length })}</td>
            </tr>
            <tr className="sum">
              <td className="k">{T('spentAll')}</td>
              <td className="v">{cash(s.totalSpent)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {sorted.length > 0 && (
        <section>
          <div className="caption">{T('whatOn')}</div>
          <table className="facts" style={{ marginTop: 14, width: '100%', maxWidth: 560 }}>
            <tbody>
              {sorted.map(([k, v]) => (
                <tr key={k}>
                  <td className="k">{k}</td>
                  <td style={{ width: '46%', paddingLeft: 16 }}>
                    <span
                      style={{
                        display: 'block',
                        borderTop: '4px solid var(--ink)',
                        width: `${((v / peak) * 100).toFixed(1)}%`,
                      }}
                    />
                  </td>
                  <td className="v">{cash(v)}</td>
                  <td className="v faint" style={{ width: 56 }}>
                    {s.totalSpent ? ((v / s.totalSpent) * 100).toFixed(0) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <div className="caption">{T('settleHistory')}</div>
        <table className="facts" style={{ marginTop: 14, minWidth: 400 }}>
          <tbody>
            {ledger.settlements.map((x) => (
              <tr key={x.id}>
                <td className="k">{x.label}</td>
                <td className="k faint">{x.date}</td>
                <td className="v">{cash(x.snapshot.totalAmount)}</td>
              </tr>
            ))}
            {s.unsettledAmount !== 0 && (
              <tr>
                <td className="k faint">{T('notSettled')}</td>
                <td />
                <td className="v faint">{cash(s.unsettledAmount)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <AdSlot />
    </main>
  );
}
