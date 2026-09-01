'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { markTransferReceived, markTransferSent } from '../../actions/ledger.ts';
import { useHelper } from '../../helper/HelperContext.tsx';
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
  /** 보냈다고 표시한 시각. 얼마나 기다렸는지를 적는 데 쓴다. */
  sentAt?: string | null;
  bank: string;
  accountNo: string;
};

/**
 * 기다린 날수 (§16)
 *
 * 보낸 사람이 표시하고 받은 사람이 확인하지 않으면 그 송금은 그대로 멈춘다.
 * 학기가 끝나면 아무도 앱에 안 들어오니 실제로 자주 그렇게 된다.
 *
 * 그래도 **닫지는 않는다.** 돈이 오갔다고 판정하는 것은 여전히 받은 사람뿐이다.
 * 대신 얼마나 기다렸는지를 적는다. 장부는 판정하지 않고 사실만 말한다 —
 * 그 사실이 누르게 만든다.
 */
function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

export default function Moving({
  ledgerId,
  toMe,
  fromMe,
  others = [],
  owner = false,
  currency,
  lang,
}: {
  ledgerId: string;
  toMe: Row[];
  fromMe: Row[];
  /** 나와 상관없는 송금. 소유자에게만 넘어온다. */
  others?: Row[];
  owner?: boolean;
  currency: CurrencyCode;
  lang: Locale;
}) {
  const router = useRouter();
  const T = translator(lang);
  const { say } = useHelper();
  const [busy, setBusy] = useState(false);
  /** 대신 확인하려고 되묻는 중인 송금. 되돌릴 수 없어서 한 번 더 묻는다. */
  const [asking, setAsking] = useState<string | null>(null);
  const cash = (n: number) => formatMoney(n, currency, lang);

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    await fn();
    setBusy(false);
    router.refresh();
  }

  const stuck = owner ? others : [];

  if (!toMe.length && !fromMe.length && !stuck.length) {
    return (
      <p className="muted" style={{ marginTop: 16 }}>
        {T('none')}
      </p>
    );
  }

  return (
    <>
      <div className="scroll" style={{ marginTop: 16 }}>
        <table className="book transfers">
          <tbody>
            {/* 내가 보낼 것 */}
            {fromMe.map((t) => (
              <tr key={t.transferId}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {T('me')} → {t.who}
                </td>
                <td className="r money debit">{cash(t.amount)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {t.sent ? (
                    <>
                      {/* 보낸 쪽에도 기다린 시간을 적는다. 상대가 안 눌러 주고
                          있다는 것을 알아야 다시 말이라도 걸 수 있다. */}
                      <span className="muted">
                        {T('sentWaiting')}
                        {(() => {
                          const d = daysSince(t.sentAt);
                          return d && d > 0 ? ` · ${T('waitedDays', { n: d })}` : '';
                        })()}
                      </span>{' '}
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
                <td className="muted">
                  {t.sent
                    ? (() => {
                        const d = daysSince(t.sentAt);
                        return d === null || d === 0
                          ? T('saysSent', { who: t.who })
                          : T('saysSentDays', { who: t.who, n: d });
                      })()
                    : ''}
                </td>
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
            {/*
              나와 상관없는 송금 (소유자에게만)

              받는 사람이 끝내 확인하지 않으면 그 정산은 영원히 안 닫힌다.
              학기가 끝나면 아무도 앱에 안 들어오기 때문에 실제로 자주 그렇게
              된다. 안 닫히는 장부도 틀린 장부라서, 소유자에게만 대신 누를
              길을 연다.

              눌러도 누가 눌렀는지는 남는다. 이건 판정을 옮기는 것이 아니라,
              판정할 사람이 사라졌을 때의 마지막 길이다. 그래서 되묻는다.
            */}
            {stuck.map((t) => (
              <tr key={t.transferId} className="left">
                <td style={{ whiteSpace: 'nowrap' }}>{t.who}</td>
                <td className="r money">{cash(t.amount)}</td>
                <td className="muted">
                  {(() => {
                    const d = daysSince(t.sentAt);
                    if (t.sent && d !== null && d > 0) return T('waitedDays', { n: d });
                    if (t.sent) return T('sentWaiting');
                    return '';
                  })()}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {asking === t.transferId ? (
                    <span className="acts">
                      <button
                        className="plain danger"
                        disabled={busy}
                        onClick={() => {
                          setAsking(null);
                          run(() =>
                            markTransferReceived({
                              ledgerId,
                              transferId: t.transferId,
                              onBehalf: true,
                            }),
                          );
                        }}
                      >
                        {T('confirmFor')}
                      </button>
                      <button className="plain" onClick={() => setAsking(null)}>
                        {T('close')}
                      </button>
                    </span>
                  ) : (
                    <button
                      className="plain"
                      disabled={busy}
                      onClick={(e) => {
                        setAsking(t.transferId);
                        say(T('confirmForWarn'), 'warn', e.currentTarget);
                      }}
                    >
                      {T('confirmFor')}
                    </button>
                  )}
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
