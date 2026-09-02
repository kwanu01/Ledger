'use client';

import { useEffect, useRef, useState } from 'react';
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
 * 그래서 화면을 덮는다. 가운데에 한 줄 입력칸을 크게 두고, 오간 말이 그 아래로
 * 쌓인다. 뒤의 장부는 어둡게 가라앉혀 지금 할 일이 하나임을 분명히 한다.
 * Esc나 바깥을 누르면 닫히고, 물어본 것은 남는다.
 */
export default function AskPanel({
  ledgerId,
  lang,
  onClose,
  onBusy,
}: {
  /** 장부 안에서 열면 그 장부에 대해 묻고, 없으면 서비스 전반을 묻는다. */
  ledgerId?: string;
  lang: Locale;
  onClose: () => void;
  /** 읽는 동안과 대답한 뒤의 자세를 수증이가 따라 하도록 알린다. */
  onBusy: (state: 'reading' | 'answered' | 'failed') => void;
}) {
  const T = translator(lang);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);
  const box = useRef<HTMLDivElement>(null);

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

  // 새 대답이 오면 그 줄이 보이게 내려 준다.
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [history, busy]);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    onBusy('reading');
    setHistory((h) => [...h, { role: 'user', text: q }]);
    setQuestion('');

    const r = ledgerId
      ? await askHelper({ ledgerId, question: q, history })
      : await askOpen({ question: q, history });
    setBusy(false);
    if (r.ok) {
      onBusy('answered');
      setHistory((h) => [...h, { role: 'assistant', text: r.answer }]);
    } else {
      onBusy('failed');
      setHistory((h) => [...h, { role: 'assistant', text: r.message }]);
    }
  }

  return (
    <div className="ask-over" onClick={onClose} role="dialog" aria-modal="true">
      <div className="ask-panel" onClick={(e) => e.stopPropagation()}>
        {(history.length > 0 || busy) && (
          <div className="ask-log" ref={box}>
            {history.map((t, i) => (
              <p key={i} className={t.role === 'user' ? 'asked' : 'answered'}>
                {t.text}
              </p>
            ))}
            {busy && <p className="answered faint">{T('helperReading')}</p>}
          </div>
        )}

        {/* 묻는 자리는 아래에 둔다. 오간 말이 위로 쌓이고 새 말은 아래에서
            들어가는 것이, 사람이 대화를 읽는 방향과 같다. */}
        <div className="ask-foot">
          <input
            type="text"
            className="ask-line"
            value={question}
            autoFocus
            placeholder={T('helperAskWhat')}
            disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
          />
          <button className="act" disabled={busy || !question.trim()} onClick={ask}>
            {busy ? T('helperReading') : T('helperAskGo')}
          </button>
        </div>
        <p className="faint ask-hint">{T('askHint')}</p>
      </div>
    </div>
  );
}
