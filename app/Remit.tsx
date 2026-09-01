'use client';

import { useEffect, useState } from 'react';
import { translator } from '../lib/i18n.ts';
import { useHelper } from './helper/HelperContext.tsx';
import type { CurrencyCode, Locale } from '../lib/domain/money.ts';

/**
 * 실제로 돈을 보내는 자리 (§16)
 *
 * 정산이 끝나도 "그래서 어디로 보내지"가 남는다. 계좌가 적혀 있으면 여기서 끝난다.
 *
 * 계좌를 누르면 복사된다. 복사 버튼을 따로 두지 않는 이유는, 복사하려고
 * 계좌를 누르는 것이 이미 사람이 하는 행동이기 때문이다. 누르면 되는 것을
 * 옆에 버튼을 세워 두고 그걸 누르라고 하면 한 단계가 더 생긴다.
 *
 * 토스 링크는 토스가 문서로 안내하는 방식이 아니라 알려져서 쓰이는 주소 형식이다.
 * 그래서 두 가지를 지킨다.
 *   · 앱이 있을 수 없는 곳(PC 브라우저)에서는 아예 보여 주지 않는다. 눌러도
 *     아무 일도 안 나는 버튼은 고장 난 버튼이다.
 *   · 눌러도 토스가 열리지 않으면 계좌를 대신 복사하고 그렇다고 말해 준다.
 */

export function tossLink(bank: string, accountNo: string, amount: number, currency: CurrencyCode) {
  // 원 단위가 아닌 통화는 토스가 받지 않는다. 그럴 땐 링크를 만들지 않는다.
  if (currency !== 'KRW' || !bank || !accountNo) return null;
  const q = new URLSearchParams({
    bank,
    accountNo,
    amount: String(amount),
    origin: 'linkpay',
  });
  return `supertoss://send?${q.toString()}`;
}

export default function Remit({
  bank,
  accountNo,
  amount,
  currency,
  lang,
}: {
  bank: string;
  accountNo: string;
  amount: number;
  currency: CurrencyCode;
  lang: Locale;
}) {
  const T = translator(lang);
  const { say } = useHelper();
  const [copied, setCopied] = useState(false);
  const [handheld, setHandheld] = useState(false);

  // 토스 앱은 손에 드는 기기에만 있다. PC에서는 링크 자체를 두지 않는다.
  useEffect(() => {
    setHandheld(
      typeof navigator !== 'undefined' &&
        (/android|iphone|ipad|ipod/i.test(navigator.userAgent) ||
          (navigator.maxTouchPoints > 1 && /mac/i.test(navigator.platform))),
    );
  }, []);

  if (!bank || !accountNo) {
    return <span className="faint">{T('noAccount')}</span>;
  }

  const link = handheld ? tossLink(bank, accountNo, amount, currency) : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${bank} ${accountNo}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      // 복사가 막혀 있으면 계좌가 화면에 그대로 있으니 손으로 고르면 된다.
      return false;
    }
  }

  function toToss(e: React.MouseEvent) {
    if (!link) return;
    e.preventDefault();
    const left = () => document.hidden;
    window.location.href = link;
    // 앱이 안 열리면 화면이 그대로 있다. 그때는 계좌를 대신 넘겨 준다.
    setTimeout(async () => {
      if (left()) return;
      await copy();
      say(T('tossMissing'), 'info');
    }, 1400);
  }

  return (
    <span className="remit-to">
      {/* 계좌 자체가 복사 버튼이다. */}
      <button className="acct num" onClick={copy} title={T('copyAccount')}>
        {bank} {accountNo}
        {copied && <span className="acct-done"> {T('copied')}</span>}
      </button>
      {link && (
        <a className="plain" href={link} onClick={toToss}>
          {T('openToss')}
        </a>
      )}
    </span>
  );
}
