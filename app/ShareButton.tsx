'use client';

import { useState } from 'react';
import Script from 'next/script';
import { translator } from '../lib/i18n.ts';
import type { Locale } from '../lib/domain/money.ts';

/**
 * 카카오톡으로 보내기 (§16)
 *
 * 세 갈래로 시도한다. 앞의 것이 없으면 다음으로 내려간다.
 *
 *   1. 운영체제 공유 목록 — 폰에는 이게 있고, 그 안에 카카오톡이 있다.
 *      앱 키도 도메인 등록도 필요 없어서 제일 안 깨진다.
 *   2. 카카오 JS SDK — 공유 목록이 없는 자리(대개 PC)에서 쓴다. 카카오톡
 *      공유창이 열리고, 어느 방에 보낼지는 카카오톡이 묻는다. 우리는 방
 *      목록을 알지 못하고 알 필요도 없다.
 *   3. 복사 — 둘 다 없으면 글을 복사해 준다. 붙여 넣으면 그만이다.
 *
 * 어느 쪽이든 사람이 보내는 것이지 서버가 대신 보내지 않는다. 서버가 보내는
 * "친구에게 메시지" API는 비즈니스 심사가 필요하고 하루 건수 제한이 있다.
 *
 * ── 주소는 글 안에 적는다 ──────────────────────────────────────────
 *
 * 카카오 SDK의 link.webUrl 은 개발자 콘솔에 등록한 "사이트 도메인"과 맞아야
 * 한다. 안 맞으면 카카오가 그 주소로 보내 주지 않고 apps.kakao.com 의 앱 설정
 * 화면으로 데려간다. PC 카카오톡에서는 그 카드의 링크가 아예 안 눌리기도 한다.
 *
 * 그래서 주소를 카드에만 맡기지 않고 글 본문에 그대로 적는다. 카카오톡은
 * 본문의 주소를 알아서 누를 수 있게 만들고, 그건 PC에서도 똑같이 된다.
 * 카드가 안 뜨든 도메인 등록을 안 했든, 받은 사람은 주소를 누를 수 있다.
 */

const JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;

/**
 * 보내는 주소는 **늘 이 사이트의 정식 주소**다.
 *
 * 지금 열려 있는 창의 주소를 쓰면 미리보기 배포(...vercel.app)나 개발용
 * localhost 주소가 그대로 카카오톡에 실려 나간다. 받은 사람은 못 여는
 * 주소를 받게 되고, 카카오도 등록되지 않은 도메인이라며 거절한다
 * (에러 4019 — 개발자 콘솔에 등록한 사이트 도메인과 맞아야 한다).
 *
 * 그래서 우리가 적어 둔 값을 먼저 쓴다. 서버 쪽 lib/origin.ts 와 같은 규칙이다.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');

type Kakao = {
  isInitialized: () => boolean;
  init: (key: string) => void;
  Share: { sendDefault: (o: unknown) => void };
};

export default function ShareButton({
  text,
  lang,
  small = true,
  withLink = true,
  href,
  onSent,
}: {
  text: string;
  lang: Locale;
  small?: boolean;
  /** 글 끝에 주소를 붙인다. 받은 사람이 눌러 바로 확인할 수 있다. */
  withLink?: boolean;
  /**
   * 받은 사람이 가야 할 자리. '보냈어요'를 누를 수 있는 화면이어야 한다.
   * 비우면 지금 보고 있는 화면.
   */
  href?: string;
  /** 보내고 나면 부를 것. 보내기가 끝났으니 이 화면도 끝났다는 뜻이다. */
  onSent?: () => void;
}) {
  const T = translator(lang);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  const target = () => {
    if (typeof window === 'undefined') return '';
    const base = SITE || window.location.origin;
    // 주소를 안 받았으면 지금 보고 있는 자리. 다만 도메인은 정식 주소로 바꾼다.
    const path = href ?? window.location.pathname + window.location.search;
    return new URL(path, base).toString();
  };

  const body = () => (withLink ? `${text}\n\n${target()}` : text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(body());
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      // 복사가 막혀 있으면 아무 일도 하지 않는다. 아래 글이 화면에 그대로 있다.
    }
  }

  /**
   * 손에 들고 쓰는 기기인가.
   *
   * 폰에는 운영체제가 주는 공유 목록이 있고, 그 안에 카카오톡이 들어 있다.
   * 그 길은 **앱 키도 도메인 등록도 필요 없다.** 카카오 SDK 는 개발자
   * 콘솔에 사이트 도메인이 등록되어 있어야 하고, 안 되어 있으면 sharer 가
   * "잘못된 요청입니다" 한 장을 띄우고 끝난다 — 돌아올 길도 없다.
   *
   * 실제로 그 화면을 봤다. 그래서 순서를 뒤집는다. 폰에서는 운영체제에
   * 먼저 맡기고, 그게 없는 자리(대개 PC)에서만 SDK 로 간다.
   */
  function handheld() {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      (navigator.maxTouchPoints ?? 0) > 0
    );
  }

  async function osShare() {
    if (typeof navigator.share !== 'function') return false;
    try {
      await navigator.share({ text: body() });
      return true;
    } catch {
      // 사용자가 닫았거나 기기가 못 하겠다고 하면 다음 길로.
      return false;
    }
  }

  function kakaoShare() {
    const w = window as unknown as { Kakao?: Kakao };
    if (!JS_KEY || !ready || !w.Kakao) return false;
    try {
      if (!w.Kakao.isInitialized()) w.Kakao.init(JS_KEY);
      // 본문에도 주소를 넣는다. 카드의 링크가 막혀도 이건 눌린다.
      w.Kakao.Share.sendDefault({
        objectType: 'text',
        text: body(),
        link: { webUrl: target(), mobileWebUrl: target() },
        buttonTitle: T('openBook'),
      });
      return true;
    } catch {
      return false;
    }
  }

  async function share() {
    if (handheld() && (await osShare())) return onSent?.();
    if (kakaoShare()) return onSent?.();
    if (await osShare()) return onSent?.();
    await copy();
    onSent?.();
  }

  return (
    <>
      {JS_KEY && (
        <Script
          src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js"
          integrity="sha384-TiCUE00h649CAMonG018J2ujOgDKW/kVWlChEuu4jK2vxfAAD0eZxzCKakxg55G4"
          crossOrigin="anonymous"
          onReady={() => setReady(true)}
        />
      )}
      <button className={`act${small ? ' small' : ''}`} onClick={share}>
        {done ? T('copied') : T('shareKakao')}
      </button>
    </>
  );
}
