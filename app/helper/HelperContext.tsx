'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  /*
   * **ctx가 아니라 ctx.say에 매단다.**
   *
   * ctx는 지금 하는 말(line)을 담고 있어서 말이 바뀔 때마다 새 객체가 된다.
   * 여기서 ctx에 매달면 그때마다 say도 새 함수가 되고, 이 say를 의존성으로
   * 둔 <Say>의 effect가 다시 돌아 같은 말을 또 한다 — 말이 스스로 지나가게
   * 만들자마자 그 자리에서 다시 켜지는 고리가 됐다. 화면에는 5초짜리 말이
   * 영원히 떠 있는 것으로 보였다.
   *
   * ctx.say 자체는 처음 한 번 만들어지고 바뀌지 않으므로, 그것에 매달면
   * 이 함수도 바뀌지 않는다.
   */
  const tell = ctx?.say;
  return useMemo(
    () => ({
      say: (text: string, tone: Tone = 'warn', near?: HTMLElement | null) =>
        tell?.(text, tone, near),
    }),
    [tell],
  );
}

export function useHelperLine(): Ctx | null {
  return useContext(HelperCtx);
}

let seq = 0;

/**
 * 말이 남아 있는 시간.
 *
 * 전에는 사람이 치울 때까지 남았다. 머리 위 점이 빨개지고, 그 점을 눌러야
 * 말이 사라졌다. 두 가지가 잘못됐다.
 *
 *   · **일을 하나 떠넘긴다.** 잘못은 이미 알았는데 치우는 일이 하나 더 생긴다.
 *   · **거기서 멈춘다.** 치울 때까지 다른 말을 못 하니, 한참 뒤에 점을 누르면
 *     지나간 일에 대한 말이 그제야 나온다 — 정산을 다 끝낸 뒤에 눌렀는데
 *     '정산할 지출이 없습니다'가 떠 있는 식이다.
 *
 * 그래서 말은 **스스로 지나간다.** 다섯 초는 한 줄을 읽고도 남는 시간이고,
 * 읽지 못했으면 같은 일을 다시 해 보면 같은 말이 다시 나온다. 지나간 뒤에는
 * 하던 이야기로 돌아간다.
 */
const LINE_MS = 5000;

export function HelperProvider({ children }: { children: React.ReactNode }) {
  const [line, setLine] = useState<Line | null>(null);
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, tone: Tone = 'warn', near?: HTMLElement | null) => {
    const t = text.trim();
    if (!t) return;
    seq += 1;
    let at: Spot | undefined;
    if (near) {
      const r = near.getBoundingClientRect();
      if (r.width || r.height) at = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    const id = seq;
    setLine({ id, text: t, tone, at });
    if (fade.current) clearTimeout(fade.current);
    // 다음 말이 이미 왔으면 이 시계는 남의 말을 지우게 된다. id로 확인한다.
    fade.current = setTimeout(() => setLine((cur) => (cur?.id === id ? null : cur)), LINE_MS);
  }, []);

  const hush = useCallback(() => {
    if (fade.current) clearTimeout(fade.current);
    setLine(null);
  }, []);

  useEffect(() => () => { if (fade.current) clearTimeout(fade.current); }, []);

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
