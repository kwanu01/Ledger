'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Remit from '../../Remit.tsx';
import { markTransferReceived, markTransferSent } from '../../actions/ledger.ts';
import { translator } from '../../../lib/i18n.ts';
import { formatMoney, type CurrencyCode, type Locale } from '../../../lib/domain/money.ts';

/**
 * 주고받을 돈 (§16)
 *
 * 두 사람의 일이 나뉘어 있다.
 *   보내는 사람 — 계좌를 보고 보낸 뒤 "보냈어요"를 누른다. 보내는 순간을 아는 건 이쪽이다.
 *   받는 사람   — 통장을 보고 "받았어요"를 누른다. 돈이 오갔다고 판정하는 건 이쪽뿐이다.
 *
 * 그래서 보냈다는 표시만으로는 송금이 닫히지 않는다. 다만 받는 사람이 무엇을
 * 확인해야 하는지 알 수 있게 된다.
 */

export type Row = {
  transferId: string;
  who: string;
  amount: number;
  sent: boolean;
  bank: string;
  accountNo: string;
};

export default function Moving({
  ledgerId,
  toMe,
  fromMe,
  currency,
  lang,
}: {
  ledgerId: string;
  toMe: Row[];
  fromMe: Row[];
  currency: CurrencyCode;
  lang: Locale;
}) {
  const router = useRouter();
  const T = translator(lang);
  const [busy, setBusy] = useState(false);
  const cash = (n: number) => formatMoney(n, currency, lang);

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    await fn();
    setBusy(false);
    router.refresh();
  }

  if (!toMe.length && !fromMe.length) {
    return (
      <p className="muted" style={{ marginTop: 16 }}>
        {T('none')}
      </p>
    );
  }

  return (
    <>
      <div className="scroll" style={{ marginTop: 16 }}>
        <table className="book">
          <tbody>
            {/* 내가 보낼 것 — 계좌가 바로 옆에 있어야 한 번에 끝난다. */}
            {fromMe.map((t) => (
              <tr key={t.transferId}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {T('me')} → {t.who}
                </td>
                <td className="r money debit">{cash(t.amount)}</td>
                <td>
                  <Remit
                    bank={t.bank}
                    accountNo={t.accountNo}
                    amount={t.amount}
                    currency={currency}
                    lang={lang}
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {t.sent ? (
                    <>
                      <span className="muted">{T('sentWaiting')}</span>{' '}
                      <button
                        className="plain"
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            markTransferSent({ ledgerId, transferId: t.transferId, undo: true }),
                          )
                        }
                      >
                        {T('undoSent')}
                      </button>
                    </>
                  ) : (
                    <button
                      className="act small"
                      disabled={busy}
                      onClick={() => run(() => markTransferSent({ ledgerId, transferId: t.transferId }))}
                    >
                      {T('iSent')}
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {/* 내가 받을 것 */}
            {toMe.map((t) => (
              <tr key={t.transferId}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {t.who} → {T('me')}
                </td>
                <td className="r money">{cash(t.amount)}</td>
                <td className="muted">{t.sent ? T('saysSent', { who: t.who }) : ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="act small"
                    disabled={busy}
                    onClick={() => run(() => markTransferReceived({ ledgerId, transferId: t.transferId }))}
                  >
                    {T('gotIt')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toMe.length > 1 && (
        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="act small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              for (const t of toMe) {
                await markTransferReceived({ ledgerId, transferId: t.transferId });
              }
              setBusy(false);
              router.refresh();
            }}
          >
            {T('gotAll', { n: toMe.length })}
          </button>
        </div>
      )}
    </>
  );
}
