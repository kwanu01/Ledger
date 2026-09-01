'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * 말을 한 군데로 모으는 자리 (§21.10)
 *
 * 경고와 안내가 화면마다 다른 곳에 뜨면, 사용자는 무엇이 잘못됐는지 찾으러
 * 화면을 훑어야 한다. 이 서비스에는 말을 하는 자리가 하나뿐이다 — 도우미의
 * 머리 위 말풍선.
 *
 * 어느 화면에서든 useHelper().say('...') 를 부르면 그리로 간다.
 * 서버에서 렌더한 화면(주소에 붙어 온 오류 같은 것)은 <Say text={...} /> 로 넘긴다.
 */

export type Tone = 'warn' | 'info';
export type Line = { id: number; text: string; tone: Tone };

type Ctx = {
  line: Line | null;
  say: (text: string, tone?: Tone) => void;
  hush: () => void;
};

const HelperCtx = createContext<Ctx | null>(null);

/** 도우미가 없는 자리에서 불러도 터지지 않는다. 말할 곳이 없으면 조용히 넘어간다. */
export function useHelper(): { say: (text: string, tone?: Tone) => void } {
  const ctx = useContext(HelperCtx);
  return useMemo(
    () => ({ say: (text: string, tone: Tone = 'warn') => ctx?.say(text, tone) }),
    [ctx],
  );
}

export function useHelperLine(): Ctx | null {
  return useContext(HelperCtx);
}

let seq = 0;

export function HelperProvider({ children }: { children: React.ReactNode }) {
  const [line, setLine] = useState<Line | null>(null);

  const say = useCallback((text: string, tone: Tone = 'warn') => {
    const t = text.trim();
    if (!t) return;
    seq += 1;
    setLine({ id: seq, text: t, tone });
  }, []);

  const hush = useCallback(() => setLine(null), []);

  const value = useMemo(() => ({ line, say, hush }), [line, say, hush]);
  return <HelperCtx.Provider value={value}>{children}</HelperCtx.Provider>;
}

/**
 * 서버에서 만든 말 한 줄을 도우미에게 넘긴다.
 * 주소에 error=... 로 붙어 오는 것들이 이 길로 온다.
 */
export function Say({ text, tone = 'warn' }: { text?: string; tone?: Tone }) {
  const { say } = useHelper();
  useEffect(() => {
    if (text) say(text, tone);
  }, [text, tone, say]);
  return null;
}
