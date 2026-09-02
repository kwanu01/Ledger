'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { askHelper, askOpen } from '../actions/ask.ts';
import type { Turn } from '../../lib/ai/ask.ts';
import { translator } from '../../lib/i18n.ts';
import type { Locale } from '../../lib/domain/money.ts';

/**
 * 장부에 대해 묻는 자리 (§21.10)
 *
 * 말풍선 안에 넣어 봤더니 너무 좁았다. 질문은 한 줄이어도 대답은 여러 줄이고,
 * 앞서 무엇을 물었는지도 같이 보여야 한다. 좁은 칸에 넣으면 읽으려고 스크롤을
 * 하게 되고, 그러면 묻는 일보다 읽는 일이 더 번거로워진다.
 *
 * 그래서 화면을 덮는다. 오간 말이 위로 쌓이고 묻는 칸은 아래에 있다.
 *
 * ── 수증이 안에 두지 않는다 ────────────────────────────────────────
 *
 * 이 창은 `document.body` 에 따로 그린다(createPortal).
 *
 * 전에는 수증이(.helper) 안에 있었다. 넓은 화면에서는 티가 안 났지만 폰에서는
 * 창이 오른쪽에 손바닥만 하게 붙어 나왔다. 폰에서 수증이는 `transform:scale(.72)`
 * 로 작아지는데, **transform 이 걸린 조상이 있으면 그 안의 `position:fixed` 는
 * 화면이 아니라 그 조상을 기준으로 잡힌다.** 156px 짜리 종이 한 장이 기준이니
 * 창도 그만해진 것이다. 배율까지 같이 먹어서 글씨도 작았다.
 *
 * 화면을 덮는 창은 화면의 자식이어야 한다. 수증이는 이 창을 여닫을 뿐이다.
 *
 * ── 자판이 올라와도 묻는 칸은 남는다 ──────────────────────────────
 *
 * 폰에서 `100dvh` 로 두면 자판이 올라올 때 창의 아래쪽 — 하필 묻는 칸이 있는
 * 쪽 — 이 자판 밑으로 들어간다. dvh 는 주소창은 세지만 자판은 안 센다.
 * 자판까지 세는 자는 `visualViewport` 뿐이라, 그 높이를 그대로 받아 쓴다.
 *
 * ── 오간 말은 창이 닫혀도 남는다 ─────────────────────────────────
 *
 * 그래서 `history` 를 이 안에 두지 않는다. 창은 닫으면 사라지는 것이고,
 * 대화는 사라지면 안 되는 것이다. 둘의 수명이 다르므로 사는 곳도 다르다 —
 * 대화는 수증이가 들고 있고(Helper.tsx), 이 창은 그것을 보여 줄 뿐이다.
 */
export default function AskPanel({
  ledgerId,
  lang,
  history,
  onHistory,
  onClose,
  onBusy,
}: {
  /** 장부 안에서 열면 그 장부에 대해 묻고, 없으면 서비스 전반을 묻는다. */
  ledgerId?: string;
  lang: Locale;
  /** 지금까지 오간 말. 이 창보다 오래 산다. */
  history: Turn[];
  onHistory: (next: (prev: Turn[]) => Turn[]) => void;
  onClose: () => void;
  /** 읽는 동안과 대답한 뒤의 자세를 수증이가 따라 하도록 알린다. */
  onBusy: (state: 'reading' | 'answered' | 'failed') => void;
}) {
  const T = translator(lang);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const over = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLInputElement>(null);

  // 서버에서는 document 가 없다. 첫 그림 뒤에 옮겨 붙인다.
  useEffect(() => setReady(true), []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', esc);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  /*
   * 창의 높이를 자판이 남겨 준 만큼으로 맞춘다.
   *
   * `visualViewport.height` 는 자판이 올라오면 그만큼 줄어든다. `offsetTop` 은
   * 브라우저가 화면을 밀어 올린 양이다 — 그만큼 내려 줘야 창이 제자리에 남는다.
   * 둘을 CSS 변수로 넘기고 자리 잡는 일은 CSS 가 한다.
   */
  useEffect(() => {
    if (!ready) return;
    const vv = window.visualViewport;
    const el = over.current;
    if (!vv || !el) return;
    const sync = () => {
      el.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
      el.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, [ready]);

  // 새 대답이 오면 그 줄이 보이게 내려 준다. 창을 다시 열었을 때도 마지막
  // 줄부터 보여야 한다 — 지난 대화의 첫 줄로 돌아가 있으면 이어서 묻기가 어렵다.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: ready ? 'smooth' : 'auto' });
  }, [history, busy, ready]);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    onBusy('reading');
    // 물어본 것을 먼저 붙인다. 대답을 기다리는 동안에도 무엇을 물었는지 보인다.
    const sent = [...history, { role: 'user' as const, text: q }];
    onHistory(() => sent);
    setQuestion('');

    const r = ledgerId
      ? await askHelper({ ledgerId, question: q, history })
      : await askOpen({ question: q, history });
    setBusy(false);
    onBusy(r.ok ? 'answered' : 'failed');
    onHistory((h) => [...h, { role: 'assistant', text: r.ok ? r.answer : r.message }]);
    // 대답이 왔다고 손이 갈 데가 없어지면 안 된다. 묻던 자리로 돌려놓는다.
    line.current?.focus();
  }

  if (!ready) return null;

  return createPortal(
    <div
      className="ask-over"
      ref={over}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={T('helperTitle')}
    >
      <div className="ask-panel" onClick={(e) => e.stopPropagation()}>
        {/*
          닫는 단추 (§21.10)

          바깥을 눌러도 닫히고 Esc 로도 닫히지만, 폰에는 바깥이 없다 — 창이
          화면을 다 덮는다. 눌러서 닫을 자리가 눈에 보여야 한다.
        */}
        <div className="ask-head">
          <span className="ask-who">{T('helperTitle')}</span>
          {history.length > 0 && !busy && (
            <button type="button" className="plain ask-wipe" onClick={() => onHistory(() => [])}>
              {T('askClear')}
            </button>
          )}
          <button type="button" className="ask-x" onClick={onClose} aria-label={T('close')}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M3 3 L13 13 M13 3 L3 13"
                stroke="currentColor"
                strokeWidth="1.6"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="ask-log" ref={box}>
          {history.length === 0 && !busy && <p className="faint ask-empty">{T('askOpener')}</p>}
          {history.map((t, i) => (
            <p key={i} className={t.role === 'user' ? 'asked' : 'answered'}>
              {t.text}
            </p>
          ))}
          {busy && <p className="answered faint">{T('helperReading')}</p>}
        </div>

        {/* 묻는 자리는 아래에 둔다. 오간 말이 위로 쌓이고 새 말은 아래에서
            들어가는 것이, 사람이 대화를 읽는 방향과 같다. */}
        <div className="ask-foot">
          {/*
            읽는 동안에도 칸은 살아 있다.

            전에는 `disabled` 를 걸었다. 그러면 브라우저가 그 칸에서 손을 떼게
            하고(focus 가 빠진다), 대답이 온 뒤 다시 누르지 않으면 못 쓴다.
            Enter 를 치고 이어서 묻던 사람은 매번 칸을 다시 눌러야 했다.
            보내는 것만 막으면 될 일이라, 막는 것은 단추와 ask() 안에서 한다.
          */}
          <input
            type="text"
            className="ask-line"
            value={question}
            autoFocus
            ref={line}
            placeholder={T('helperAskWhat')}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              // 한글은 조합 중에도 Enter 가 온다. 조합을 끝내는 Enter 로 묻지 않는다.
              e.preventDefault(); // 폼 안에 있어도 화면이 넘어가지 않는다
              ask();
            }}
          />
          <button className="act" disabled={busy || !question.trim()} onClick={ask}>
            {busy ? T('helperReading') : T('helperAskGo')}
          </button>
        </div>
        <p className="faint ask-hint">{T('askHint')}</p>
      </div>
    </div>,
    document.body,
  );
}
