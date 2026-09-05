'use client';

import { formatMoney, parseMoney, type CurrencyCode, type Locale } from '../../../../lib/domain/money.ts';
import { translator } from '../../../../lib/i18n.ts';
import type { Member } from '../../../../lib/domain/types.ts';

/**
 * 몰아서 적기 — 읽어 온 줄들을 확인하는 자리 (§11.4)
 *
 * 팀플 정산은 대개 "끝나고 몰아서"다. 영수증이 열 장 쌓여 있고, 한 장씩 폼을
 * 열었다 닫았다 하며 적게 하면 대부분 도중에 그만둔다. 그래서 열 장을 한꺼번에
 * 던지고 열 줄을 한 화면에서 확인한다.
 *
 * ── 확인하지 않고 저장하게 두면 안 된다
 *
 * 이 기능의 위험은 하나다. 열 줄을 한 번에 적으면 **한 줄도 안 보고 적을 수
 * 있다.** AI 가 금액을 하나 잘못 읽어도 아무도 모르고, 그러면 이 기능은
 * 장부를 빠르게 더럽히는 기능이 된다.
 *
 * 그래서 세 가지를 둔다.
 *   금액이 제일 크다. 훑을 때 눈이 먼저 닿아야 하는 칸이라서.
 *   사진이 줄 옆에 붙어 있다. 눌러 키우면 그 자리에서 대조된다.
 *   못 읽은 줄은 빨간 테두리로 남는다. 비어 있으면 저장에서 빠지고, 몇 줄이
 *   빠지는지 아래에서 미리 말한다.
 *
 * 부담 방식은 여기서 안 고른다. 전체 공동이 기본이고, 다르게 나눌 줄은
 * 적고 나서 장부에서 고친다 — 열 줄을 훑는 자리에 라디오 사십 개를 두면
 * 훑는 일 자체가 안 된다.
 */

export type Row = {
  key: string;
  file: File;
  thumb: string;
  /** 아직 읽는 중인가 */
  reading: boolean;
  /** 못 읽었으면 그 이유. 줄은 남는다 — 손으로 적으면 되니까. */
  failed?: string;
  title: string;
  amount: string;
  date: string;
  payerId: string;
  vendor?: string;
  category?: string;
  /**
   * 사진에서 읽은 금액 (§13.2). 화면에 안 보이고 고칠 수도 없다.
   * 사람이 이 줄의 금액을 고쳐도 그대로 실려 가서, 나중에 견주는 데 쓰인다.
   */
  readAmount?: number;
};

/** 이 줄이 적힐 수 있는가. 저장할 것을 고르는 기준이자 화면 표시의 기준이다. */
export function ready(r: Row, currency: CurrencyCode): boolean {
  return r.title.trim() !== '' && parseMoney(r.amount, currency) !== 0;
}

export default function BatchRows({
  rows,
  onRows,
  members,
  roster,
  currency,
  lang,
  onOpen,
}: {
  rows: Row[];
  onRows: (next: (prev: Row[]) => Row[]) => void;
  members: Member[];
  roster: string[];
  currency: CurrencyCode;
  lang: Locale;
  /** 사진을 크게 볼 때. 대조는 이 자리에서 일어난다. */
  onOpen: (thumb: string) => void;
}) {
  const T = translator(lang);
  const roll = members.filter((m) => roster.includes(m.id));

  const patch = (key: string, over: Partial<Row>) =>
    onRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...over } : r)));

  return (
    <ul className="batch">
      {rows.map((r, i) => {
        const ok = ready(r, currency);
        return (
          <li key={r.key} className={`batch-row${r.reading ? ' reading' : ''}${!r.reading && !ok ? ' blank' : ''}`}>
            <button
              type="button"
              className="batch-thumb"
              aria-label={T('batchPhotoN', { n: i + 1 })}
              onClick={() => onOpen(r.thumb)}
            >
              <img src={r.thumb} alt="" />
            </button>

            <div className="batch-fields">
              <input
                type="text"
                className="batch-title"
                value={r.title}
                placeholder={T('itemName')}
                aria-label={`${T('itemName')} ${i + 1}`}
                onChange={(e) => patch(r.key, { title: e.target.value })}
              />
              {/* 금액이 제일 크다. 훑을 때 눈이 먼저 닿아야 하는 칸이다. */}
              <input
                type="text"
                inputMode="decimal"
                className="num batch-amount"
                value={r.amount}
                placeholder="0"
                aria-label={`${T('amount')} ${i + 1}`}
                onChange={(e) => patch(r.key, { amount: e.target.value })}
              />
              <input
                type="date"
                className="batch-date"
                value={r.date}
                aria-label={`${T('date')} ${i + 1}`}
                onChange={(e) => patch(r.key, { date: e.target.value })}
              />
              <select
                className="batch-payer"
                value={r.payerId}
                aria-label={`${T('payer')} ${i + 1}`}
                onChange={(e) => patch(r.key, { payerId: e.target.value })}
              >
                {roll.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <span className="batch-say">
                {r.reading ? (
                  <span className="muted">{T('reading')}</span>
                ) : r.failed ? (
                  <span className="debit">{r.failed}</span>
                ) : (
                  <span className="faint">
                    {[r.vendor, r.category].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
            </div>

            <button
              type="button"
              className="line-drop"
              aria-label={T('batchDrop')}
              title={T('batchDrop')}
              onClick={() => onRows((prev) => prev.filter((x) => x.key !== r.key))}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 적힐 줄들의 합. 훑고 나서 "이게 다 맞나" 를 한 숫자로 확인하는 자리다. */
export function batchSum(rows: Row[], currency: CurrencyCode, lang: Locale): string {
  const sum = rows
    .filter((r) => ready(r, currency))
    .reduce((a, r) => a + parseMoney(r.amount, currency), 0);
  return formatMoney(sum, currency, lang);
}
