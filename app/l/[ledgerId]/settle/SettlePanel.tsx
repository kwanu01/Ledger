'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { settle } from '../../../actions/ledger.ts';
import ShareButton from '../../../ShareButton.tsx';
import {
  computeSettlement,
  nameOf,
  unsettledExpenses,
} from '../../../../lib/domain/settlement.ts';
import { translator, type T as Tr } from '../../../../lib/i18n.ts';
import { formatMoney, formatNumber, type CurrencyCode, type Locale } from '../../../../lib/domain/money.ts';
import type { Ledger, Member, SettlementResult, Transfer } from '../../../../lib/domain/types.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';

/**
 * 정산 내역 (§14, §21.4)
 *
 * 송금 한 줄을 펼치면 그 돈이 왜 그 금액인지 두 사람 몫이 나란히 열린다.
 * 검산은 사람 단위다. 한 줄만 놓고 맞추면 여러 명에게 받는 경우가 어긋난다.
 */

function Proof({
  result,
  memberId,
  members,
  highlight,
  currency,
  lang,
  T,
}: {
  result: SettlementResult;
  memberId: string;
  members: Member[];
  highlight: Transfer;
  currency: CurrencyCode;
  lang: Locale;
  T: Tr;
}) {
  const who = (id: string) => nameOf(members, id);
  const num = (n: number) => formatNumber(n, currency, lang);
  const b = result.balances.find((x) => x.memberId === memberId);
  if (!b) return null;

  const mine = result.transfers.filter(
    (t) => t.fromMemberId === memberId || t.toMemberId === memberId,
  );
  let running = b.totalPaid;

  return (
    <div>
      <div className="caption" style={{ marginBottom: 10 }}>
        {who(memberId)}
      </div>
      <table className="tally">
        <tbody>
          <tr>
            <td className="v">{num(b.totalPaid)}</td>
            <td className="l">{T('paid')}</td>
          </tr>
          {mine.map((t, i) => {
            const out = t.fromMemberId === memberId;
            running += out ? t.amount : -t.amount;
            return (
              <tr key={i} className={t === highlight ? 'hit' : undefined}>
                <td className="v">
                  {out ? '+ ' : '− '}
                  {num(t.amount)}
                </td>
                <td className="l">
                  {out
                    ? T('sentTo', { who: who(t.toMemberId) })
                    : T('gotFrom', { who: who(t.fromMemberId) })}
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
}

function RemitList({
  result,
  members,
  currency,
  keyPrefix,
  lang,
  T,
  meId,
}: {
  result: SettlementResult;
  members: Member[];
  currency: CurrencyCode;
  keyPrefix: string;
  lang: Locale;
  T: Tr;
  meId?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const cash = (n: number) => formatMoney(n, currency, lang);
  const who = (id: string) => nameOf(members, id);

  if (!result.transfers.length) {
    return <p className="faint" style={{ padding: '14px 0' }}>{T('none')}</p>;
  }

  // 내가 걸린 송금을 위로 올린다. 넷이 넘어가면 내 것을 찾느라 눈이 헤맨다.
  const mine = (t: Transfer) => t.fromMemberId === meId || t.toMemberId === meId;
  const ordered = meId
    ? [...result.transfers].sort((a, b) => Number(mine(b)) - Number(mine(a)))
    : result.transfers;

  return (
    <>
      {ordered.map((t, i) => {
        const id = `${keyPrefix}:${i}`;
        const on = open === id;
        return (
          <div key={id}>
            <button
              className={`remit${mine(t) ? ' mine' : ''}`}
              aria-expanded={on}
              onClick={() => setOpen(on ? null : id)}
            >
              <span className="who">
                {who(t.fromMemberId)} → {who(t.toMemberId)}
                {mine(t) && <span className="tag">{T('yourTransfers')}</span>}
              </span>
              <span className="sum">{cash(t.amount)}</span>
              <span className="ask">{on ? T('hideWork') : T('showWork')}</span>
            </button>
            {on && (
              <div className="proof">
                <div className="proof-pair">
                  <Proof
                    result={result}
                    memberId={t.fromMemberId}
                    members={members}
                    highlight={t}
                    currency={currency}
                    lang={lang}
                    T={T}
                  />
                  <Proof
                    result={result}
                    memberId={t.toMemberId}
                    members={members}
                    highlight={t}
                    currency={currency}
                    lang={lang}
                    T={T}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Balances({
  result,
  members,
  meId,
  currency,
  lang,
  T,
}: {
  result: SettlementResult;
  members: Member[];
  meId: string;
  currency: CurrencyCode;
  lang: Locale;
  T: Tr;
}) {
  const num = (n: number) => formatNumber(n, currency, lang);

  // 회계 표가 믿음직해 보이는 건 합이 맞아떨어질 때다. 낸 돈 총합과 낼 몫 총합이
  // 같고 차액 총합이 0이라는 것을 마지막 줄에서 보여 준다. 검산을 열지 않아도
  // 이 표가 옳다는 것이 여기서 드러난다.
  const totalPaid = result.balances.reduce((a, b) => a + b.totalPaid, 0);
  const totalOwed = result.balances.reduce((a, b) => a + b.totalOwed, 0);
  const totalNet = result.balances.reduce((a, b) => a + b.netBalance, 0);

  return (
    <div className="scroll">
      <table className="book balances">
        <thead>
          <tr>
            <th>{T('colMember')}</th>
            <th className="r money">{T('paid')}</th>
            <th className="r money">{T('owed')}</th>
            <th className="r money">{T('result')}</th>
          </tr>
        </thead>
        <tbody>
          {result.balances.map((b) => {
            const v = b.netBalance;
            const me = b.memberId === meId;
            return (
              <tr key={b.memberId} className={me ? 'mine' : undefined}>
                <td>
                  {nameOf(members, b.memberId)}
                  {me && <span className="faint"> {T('me')}</span>}
                </td>
                <td className="r money muted">{num(b.totalPaid)}</td>
                <td className="r money muted">{num(b.totalOwed)}</td>
                {/* 부호와 낱말이 같은 말을 두 번 하지 않도록, 낱말이 방향을 맡는다. */}
                <td className={`r result${v < 0 ? ' debit' : ''}`}>
                  {v === 0 ? (
                    <span className="muted">{T('none')}</span>
                  ) : (
                    <>
                      <span className="money">{num(Math.abs(v))}</span>
                      <span className="dir">{v > 0 ? T('toReceive') : T('toPay')}</span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          <tr className="checksum">
            <td>{T('sumRow')}</td>
            <td className="r money">{num(totalPaid)}</td>
            <td className="r money">{num(totalOwed)}</td>
            {/* 마지막 칸은 위 줄들과 같은 결과 칸이다. 세로 괘선을 두지 않는다. */}
            <td className="r result">
              <span className="money">{num(totalNet)}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function SettlePanel({
  ledger,
  meId,
  lang,
  openSeqs = [],
}: {
  ledger: Ledger;
  meId: string;
  lang: Locale;
  /** 아직 오가지 않은 송금이 남은 정산 회차. 여기 없는 회차는 다 끝난 것이다. */
  openSeqs?: number[];
  /** 받는 사람의 계좌. 요청 글에 실어야 받은 사람이 바로 보낼 수 있다. */
}) {
  const router = useRouter();
  // 경고는 도우미 말풍선 한 자리로 모인다(app/helper).
  const { say } = useHelper();
  const currency: CurrencyCode = ledger.currency ?? 'KRW';
  const cash = (n: number) => formatMoney(n, currency, lang);
  const T = translator(lang);

  const open = unsettledExpenses(ledger);

  // 지난 정산은 접어 둔다. 회차가 한꺼번에 펼쳐져 있으면 어느 것이 지금 것인지
  // 알 수 없다.
  //
  // 아직 정산하지 않은 것이 있으면 지금 볼 것은 그쪽이다. 그럴 때는 지난 정산을
  // 전부 닫아 제목만 남긴다. 정산할 게 없을 때만 가장 최근 회차를 열어 둔다.
  // 그때는 그것이 이 장부의 마지막 상태이기 때문이다.
  const latestSeq = ledger.settlements.at(-1)?.seq ?? null;
  const [openSection, setOpenSection] = useState<number | null>(
    open.length ? null : latestSeq,
  );
  const [busy, setBusy] = useState(false);
  /** 방금 확정한 정산의 보낼 글. 이게 있으면 먼저 보내라고 내민다. */
  const [justSettled, setJustSettled] = useState<string | null>(null);
  /** 방금 확정한 정산. 사람마다 다른 글을 만들려면 결과가 있어야 한다. */
  const [justSettledResult, setJustSettledResult] = useState<SettlementResult | null>(null);
  const [justSettledSeq, setJustSettledSeq] = useState(0);

  const pending = computeSettlement(open, ledger.members);
  const myNet = pending.balances.find((b) => b.memberId === meId)?.netBalance ?? 0;

  /**
   * 정산 확정.
   *
   * 확정한 뒤 곧바로 정산 내역으로 넘기지 않는다. 정산은 숫자를 확정하는
   * 일로 끝나지 않고, 그 결과를 사람들에게 알려야 비로소 끝난다. 화면이
   * 먼저 넘어가 버리면 "누구에게 얼마"를 다시 찾아 옮겨 적게 된다.
   *
   * 그래서 확정하자마자 보낼 글을 띄운다. 보내고 나서 넘어가면 된다.
   */
  async function confirm() {
    setBusy(true);
    const r = await settle({ ledgerId: ledger.id });
    setBusy(false);
    if (!r.ok) return say(r.message);
    const seq = (ledger.settlements.at(-1)?.seq ?? 0) + 1;
    setJustSettledSeq(seq);
    setJustSettledResult(pending);
    setJustSettled(message(pending, seq));
  }

  /**
   * 카카오톡으로 보낼 글. 어느 채팅방에 보낼지는 카카오톡이 묻는다.
   *
   * 두 가지를 만든다. 단톡방에 한 번에 붙일 전체 글과, 보낼 사람 한 명에게만
   * 가는 글이다.
   *
   * 전체 글은 누가 누구에게 얼마인지가 한눈에 보여야 하고, 개인 글은 받는
   * 사람이 자기 할 일만 보면 되어야 한다. 단톡방에 올린 표에서 자기 줄을
   * 찾는 일은 생각보다 잘 안 된다. 넷이 넘어가면 더 그렇다.
   *
   * 계좌는 싣지 않는다. 받을 사람의 계좌번호가 단톡방에 남는 것은 이 서비스가
   * 대신 결정할 일이 아니다. 보낼 곳은 서로 아는 사이끼리 정하면 된다.
   */
  function message(result: SettlementResult, seq: number) {
    const line = (t: (typeof result.transfers)[number]) =>
      `${nameOf(ledger.members, t.fromMemberId)} → ${nameOf(ledger.members, t.toMemberId)}  ${cash(t.amount)}`;

    return (
      `${ledger.teamName} · ${s0(seq)}\n\n` +
      result.transfers.map(line).join('\n') +
      `\n\n대상 지출 ${result.expenseIds.length}건 · ${cash(result.totalAmount)}` +
      `\n\n보낸 뒤 아래 주소에서 '보냈어요'를 눌러 주세요.`
    );
  }

  /** 보낼 사람 한 명에게만 가는 글. 그 사람이 보낼 것만 적는다. */
  function messageFor(fromId: string, result: SettlementResult, seq: number) {
    const mine = result.transfers.filter((t) => t.fromMemberId === fromId);
    const lines = mine.map(
      (t) => `${nameOf(ledger.members, t.toMemberId)}에게 ${cash(t.amount)}`,
    );
    const total = mine.reduce((a, t) => a + t.amount, 0);

    return (
      `${ledger.teamName} · ${s0(seq)}\n\n` +
      `${nameOf(ledger.members, fromId)} 님이 보낼 것\n` +
      lines.join('\n') +
      (mine.length > 1 ? `\n합계 ${cash(total)}` : '') +
      `\n\n보낸 뒤 아래 주소에서 '보냈어요'를 눌러 주세요.`
    );
  }

  /** 이번 정산에서 돈을 보내야 하는 사람들. 한 사람이 여러 곳에 보낼 수 있다. */
  function senders(result: SettlementResult) {
    const ids: string[] = [];
    for (const t of result.transfers) if (!ids.includes(t.fromMemberId)) ids.push(t.fromMemberId);
    return ids;
  }

  const s0 = (seq: number) => ledger.settlements.find((x) => x.seq === seq)?.label ?? `${seq}차 정산`;

  // 확정 직후 — 보낼 글이 먼저다. 닫으면 그때 정산 내역이 새로 그려진다.
  if (justSettled) {
    return (
      <section>
        <div className="caption">{T('settledNow')}</div>
        <p className="lede" style={{ marginTop: 10 }}>
          {T('sendItNow')}
        </p>
        <p className="aside" style={{ marginTop: 12, maxWidth: 560 }}>
          {T('settleEndsWhen')}
        </p>
        <pre className="msg" style={{ marginTop: 18 }}>
          {justSettled}
        </pre>
        <div className="row" style={{ marginTop: 20 }}>
          {/* 보내고 나면 이 화면은 할 일이 끝난다. 그때 정산 내역이 새로 그려진다. */}
          <ShareButton
            text={justSettled}
            lang={lang}
            small={false}
            href={`/l/${ledger.id}`}
            onSent={() => {
              setJustSettled(null);
              router.refresh();
            }}
          />
        </div>

        {/* 한 사람씩 보내기.
            단톡방에 올린 표에서 자기 줄을 찾는 일은 생각보다 잘 안 된다.
            보낼 사람에게 개인톡으로 자기 몫만 보내면 그 일이 없어진다. */}
        {justSettledResult && senders(justSettledResult).length > 0 && (
          <div style={{ marginTop: 26 }}>
            <div className="caption">{T('sendOneByOne')}</div>
            <div className="scroll">
              <table className="book transfers">
                <tbody>
                  {senders(justSettledResult).map((id) => {
                    const mine = justSettledResult.transfers.filter((t) => t.fromMemberId === id);
                    const sum = mine.reduce((a, t) => a + t.amount, 0);
                    return (
                      <tr key={id}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {nameOf(ledger.members, id)}
                          {id === meId && <span className="faint"> {T('me')}</span>}
                        </td>
                        <td className="r money debit">{cash(sum)}</td>
                        <td className="muted">
                          {mine
                            .map((t) => nameOf(ledger.members, t.toMemberId))
                            .join(', ')}
                        </td>
                        <td>
                          <ShareButton
                            text={messageFor(id, justSettledResult, justSettledSeq)}
                            lang={lang}
                            href={`/l/${ledger.id}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <>

      {open.length > 0 ? (
        <section>
          <div className="caption">{T('openCount', { n: open.length })}</div>
          <p className="lede">
            {open[0].date} – {open[open.length - 1].date}
          </p>

          {/* 이 화면에서 가장 먼저 알고 싶은 것은 "나는 얼마인가"다. 그것부터 놓는다. */}
          <div className="my-share">
            <div className="label">
              {myNet === 0 ? T('youEven') : myNet > 0 ? T('youReceiveLead') : T('youSendLead')}
            </div>
            {myNet !== 0 && (
              <div className={`figure${myNet < 0 ? ' debit' : ''}`}>{cash(Math.abs(myNet))}</div>
            )}
          </div>

          {/* 그다음은 실제로 할 일. 내 송금이 위로 온다. */}
          <div style={{ marginTop: 30 }}>
            <div className="caption" style={{ marginBottom: 8 }}>
              {T('transfers')}
            </div>
            <RemitList
              result={pending}
              members={ledger.members}
              currency={currency}
              keyPrefix="pending"
              lang={lang}
              T={T}
              meId={meId}
            />
          </div>

          <div className="row" style={{ marginTop: 24 }}>
            <button className="act primary" onClick={confirm} disabled={busy}>
              {busy ? T('settling') : T('doSettle')}
            </button>
          </div>

          {/* 근거는 그 아래. 궁금할 때 내려다보면 된다. */}
          <div style={{ marginTop: 34 }}>
            <Balances
              result={pending}
              members={ledger.members}
              meId={meId}
              currency={currency}
              lang={lang}
              T={T}
            />
          </div>

          <table className="facts" style={{ marginTop: 22 }}>
            <tbody>
              <tr>
                <td className="k">{T('targetAmount')}</td>
                <td className="v">{cash(pending.totalAmount)}</td>
              </tr>
              <tr>
                <td className="k">{T('sharedCost')}</td>
                <td className="v">{cash(pending.sharedAmount)}</td>
              </tr>
              <tr>
                <td className="k">{T('personalCost')}</td>
                <td className="v">{cash(pending.personalAmount)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : (
        <section>
          <div className="empty faint">{T('nothingToSettle')}</div>
        </section>
      )}

      {[...ledger.settlements].reverse().map((s) => {
        const on = openSection === s.seq;
        return (
          <section key={s.id}>
            {/*
              제목 줄 전체가 여닫는 손잡이다. 도장은 그 오른쪽에 앉는다.
              접혀 있어도 도장은 그대로 찍혀 있다 — 끝난 회차라는 표시이기 때문이다.
            */}
            <button
              className="settled-head"
              aria-expanded={on}
              onClick={() => setOpenSection(on ? null : s.seq)}
            >
              <span className="head-text">
                <span className="caption">{s.label}</span>
                <span className="lede">
                  {T('confirmedOn', {
                    date: s.date,
                    n: s.snapshot.expenseIds.length,
                    amount: cash(s.snapshot.totalAmount),
                  })}
                </span>
              </span>
              {/*
                도장은 "숫자를 확정했다"가 아니라 "돈이 다 오갔다"는 표시다.
                아직 확인되지 않은 송금이 남아 있으면 찍지 않는다. 다 보내고
                다 받았다고 눌러야 그때 이 회차가 닫힌다.
              */}
              {openSeqs.includes(s.seq) ? (
                <span className="waiting">
                  {T('waitingN', { n: s.snapshot.transfers.length })}
                </span>
              ) : (
                <span
                  className="mark"
                  aria-hidden="true"
                  style={{ transform: `rotate(${-13 + ((s.seq * 7) % 11)}deg)` }}
                >
                  <span className="big">{T('settledStamp')}</span>
                  <span className="small">{s.date}</span>
                </span>
              )}
            </button>

            {on && (
              <>
                <div style={{ marginTop: 22 }}>
                  <Balances
                    result={s.snapshot}
                    members={ledger.members}
                    meId={meId}
                    currency={currency}
                    lang={lang}
                    T={T}
                  />
                </div>

                <div style={{ marginTop: 26 }}>
                  <div className="caption" style={{ marginBottom: 8 }}>
                    {T('transfers')}
                  </div>
                  <RemitList
                    result={s.snapshot}
                    members={ledger.members}
                    currency={currency}
                    keyPrefix={`st${s.seq}`}
                    lang={lang}
                    T={T}
                    meId={meId}
                  />
                </div>

                {/* 다 오간 정산에는 보낼 것이 없다. */}
                {openSeqs.includes(s.seq) && (
                  <div className="row" style={{ marginTop: 20 }}>
                    <ShareButton
                      text={message(s.snapshot, s.seq)}
                      lang={lang}
                      // 받은 사람이 갈 곳은 '보냈어요'가 있는 홈이다.
                      href={`/l/${ledger.id}`}
                    />
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </>
  );
}
