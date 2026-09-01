'use client';

import { useState } from 'react';
import { translator } from '../lib/i18n.ts';
import type { Locale } from '../lib/domain/money.ts';

/**
 * 문의 (§20)
 *
 * 처음에는 `mailto:` 링크 하나였다. 그게 아무 일도 안 하는 자리가 되었다.
 * 폰에는 메일 앱이 안 깔려 있거나, 깔려 있어도 계정이 없거나, 브라우저가
 * 그 링크를 막아 둔 경우가 흔하다. 그러면 눌러도 화면이 그대로다. 눌러도
 * 아무 일이 없는 단추는 없는 것만 못하다 — 물어볼 데가 없다고 읽힌다.
 *
 * 그래서 누르면 **주소를 화면에 띄운다.** 메일 앱이 있는 사람은 그 자리의
 * 링크를 쓰면 되고, 없는 사람은 복사해서 쓰던 곳에 붙여 넣으면 된다.
 * 어느 쪽이든 주소는 눈으로 보인다.
 */
export default function Contact({ mail, lang }: { mail: string; lang: Locale }) {
  const T = translator(lang);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(mail);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 복사를 막아 둔 브라우저가 있다. 주소는 이미 화면에 떠 있으니
      // 손으로 옮겨 적을 수 있다. 여기서 더 할 일은 없다.
    }
  }

  return (
    <>
      <button type="button" className="linky" onClick={() => setOpen((v) => !v)}>
        {T('contact')}
      </button>

      {open && (
        <div className="mailcard">
          <a href={`mailto:${mail}`} className="mailcard-addr">
            {mail}
          </a>
          <button type="button" className="plain" onClick={copy}>
            {copied ? T('copied') : T('copy')}
          </button>
          <button
            type="button"
            className="plain"
            onClick={() => setOpen(false)}
            aria-label={T('close')}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
