'use client';

import { useState } from 'react';
import { translator } from '../lib/i18n.ts';
import type { Locale } from '../lib/domain/money.ts';

/**
 * 문의 (§20)
 *
 * 처음에는 `mailto:` 링크 하나였다. 그게 아무 일도 안 하는 자리가 되었다.
 * 폰에는 메일 앱이 안 깔려 있거나, 깔려 있어도 계정이 없거나, 브라우저가
 * 그 링크를 막아 둔 경우가 흔하다. 눌러도 아무 일이 없는 단추는 없는 것만
 * 못하다 — 물어볼 데가 없다고 읽힌다.
 *
 * 그래서 누르면 **주소를 화면에 띄운다.**
 *
 * ── 판이 아니라 같은 줄에 ──────────────────────────────────────
 *
 * 그 주소를 아래에 판(테두리 있는 상자)으로 띄웠었다. 두 가지가 어긋났다.
 *
 *   · 맨 아래 한 줄이던 것이 갑자기 두 겹이 되면서 **화면 아래가 밀렸다.**
 *   · 테두리 있는 상자는 이 화면에서 '중요한 것'의 생김새인데, 메일 주소는
 *     중요한 것이 아니라 그냥 주소다.
 *
 * 이 줄은 이미 flex 라서, 주소와 복사를 그냥 형제로 내놓으면 **오른쪽으로
 * 이어 붙는다.** 좁으면 저절로 다음 줄로 넘어간다(flex-wrap). 폰을 위해
 * 따로 짤 것이 없다 — 줄이 알아서 접힌다.
 *
 * ── 폰에서는 복사가 먼저다 ────────────────────────────────────
 *
 * 폰에서는 긴 주소를 손가락으로 긁어 고르는 것이 어렵다. 그래서 폰에서는
 * **주소 자체가 복사 단추**다(누르면 복사). 마우스가 있는 화면에서는 주소가
 * mailto: 링크이고 복사는 그 옆에 따로 있다. 같은 자리에서 다른 일을
 * 하는 것이 아니라, 그 기기에서 할 수 있는 일을 내놓는 것이다.
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
      <button
        type="button"
        className="linky"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {T('contact')}
      </button>

      {open && (
        <>
          {/* 마우스가 있는 화면 — 주소는 메일 앱으로 가는 링크다. */}
          <a href={`mailto:${mail}`} className="mail-addr desk-only">
            {mail}
          </a>
          {/* 폰 — 주소를 누르면 복사된다. 긴 주소를 손가락으로 긁지 않게. */}
          <button type="button" className="mail-addr phone-only linky" onClick={copy}>
            {copied ? T('copied') : mail}
          </button>
          <button type="button" className="plain desk-only" onClick={copy}>
            {copied ? T('copied') : T('copy')}
          </button>
        </>
      )}
    </>
  );
}
