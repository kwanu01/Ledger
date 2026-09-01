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
/** 말이 가리키는 자리. 화면 좌표(px). 있으면 수증이가 그리로 걸어간다. */
export type Spot = { x: number; y: number; w: number; h: number };
export type Line = { id: number; text: string; tone: Tone; at?: Spot };

type Ctx = {
  line: Line | null;
  say: (text: string, tone?: Tone, near?: HTMLElement | null) => void;
  hush: () => void;
};

const HelperCtx = createContext<Ctx | null>(null);

/**
 * 도우미가 없는 자리에서 불러도 터지지 않는다. 말할 곳이 없으면 조용히 넘어간다.
 *
 * 세 번째 인자에 **누른 단추**를 넘기면 수증이가 그 옆으로 걸어가서 말한다.
 * 되묻는 말("정말 지울까요")은 어느 줄에 대한 말인지가 절반이라, 화면 구석에서
 * 하면 나머지 절반이 사라진다. 그렇다고 그 줄 안에 긴 문장을 넣으면 표가
 * 벌어져 이름이 세로로 쪼개진다 — 실제로 그렇게 됐다.
 *
 * 말은 수증이가 하고, 줄에는 단추만 남긴다.
 */
export function useHelper(): {
  say: (text: string, tone?: Tone, near?: HTMLElement | null) => void;
} {
  const ctx = useContext(HelperCtx);
  return useMemo(
    () => ({
      say: (text: string, tone: Tone = 'warn', near?: HTMLElement | null) =>
        ctx?.say(text, tone, near),
    }),
    [ctx],
  );
}

export function useHelperLine(): Ctx | null {
  return useContext(HelperCtx);
}

let seq = 0;

export function HelperProvider({ children }: { children: React.ReactNode }) {
  const [line, setLine] = useState<Line | null>(null);

  const say = useCallback((text: string, tone: Tone = 'warn', near?: HTMLElement | null) => {
    const t = text.trim();
    if (!t) return;
    seq += 1;
    let at: Spot | undefined;
    if (near) {
      const r = near.getBoundingClientRect();
      if (r.width || r.height) at = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    setLine({ id: seq, text: t, tone, at });
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
