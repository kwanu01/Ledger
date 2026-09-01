'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useHelperLine } from './HelperContext.tsx';
import AskPanel from './AskPanel.tsx';
import { translator, type Key } from '../../lib/i18n.ts';
import type { Locale } from '../../lib/domain/money.ts';

/**
 * 길잡이 (§21.10)
 *
 * 종이 영수증 한 장이 장부 옆에 서 있다. 하는 일은 셋이다.
 *
 *   1. 화면이 할 말이 있으면 손을 흔든다. 머리 위 단추를 누르면 말풍선이 열린다.
 *   2. 장부에 대해 물어보면 읽고 대답한다. 숫자는 서버가 계산한 것만 쓴다.
 *   3. 몸으로 지금 무슨 일이 일어났는지 알린다.
 *
 * ── 누르는 자리와 잡는 자리를 나눈다 ──────────────────────────────
 *
 * 말풍선은 머리 위 단추로 열고, 몸은 잡아서 옮긴다. 한 자리에 두 가지 뜻을
 * 넣으면 — 짧게 누르면 이것, 길게 누르면 저것 — 둘 중 하나는 반드시 어긋난다.
 * 기다릴 것도 없어진다. 누르면 그 자리에서 열리고, 끌면 그 자리에서 끌려온다.
 *
 * ── 자세는 맥락이 정한다 ──────────────────────────────────────────
 *
 * 무작위로 팔을 들었다 내렸다 하면 살아 있는 것이 아니라 고장 난 것으로 보인다.
 * 그래서 자세가 바뀌는 자리는 전부 "무슨 일이 있었는가"에 붙어 있다.
 *
 *   화면을 옮겼다   → 그 화면에 맞는 인사 한 번
 *   할 말이 생겼다  → 손을 흔든다
 *   말풍선을 열었다 → 가리킨다
 *   장부를 읽는 중  → 들여다본다
 *   대답이 나왔다   → 웃는다
 *   들어 올렸다     → 팔을 벌린다
 *   내려놓았다      → 한 번 통 튄다
 *   오래 조용하다   → 눕는다
 *
 * 그 사이에는 서 있는다. 서 있는 동안의 들썩임은 호흡이라 그림이 바뀌지 않는다.
 *
 * ── 옮길 때는 관성이 있다 ─────────────────────────────────────────
 *
 * 손끝을 그대로 따라가지 않는다. 종이 한 장이라 조금 늦게 따라오고, 멈추면
 * 지나쳤다가 돌아온다. 빠르게 끌면 그만큼 기운다. 그 지연과 기울기가 무게다.
 */

const SPOT_KEY = 'ledger_helper_spot';
const HIDE_KEY = 'ledger_helper_off';

/** 그림 크기 (public/helper/*.png 는 전부 같은 종이에 발을 맞춰 그렸다) */
const W = 156;
const H = 156;
/** 머리 위 단추가 놓일 자리. 이만큼은 위에 남겨 둬야 한다. */
const TOP_ROOM = 34;
/** 몇 px 넘게 움직여야 "옮기려던 것"으로 본다. 손은 조금씩 떨린다. */
const DRAG_SLOP = 4;

/**
 * 화면마다 한 번씩 하는 인사. 탭을 옮긴 것도 하나의 사건이다.
 * 화면마다 다른 자세를 줘야 옮겼다는 것이 몸으로도 읽힌다.
 */
function greetFor(path: string | null): { pose: string; trick: string; ms: number } {
  const nod = { trick: 'nod', ms: 620 };
  const wig = { trick: 'wiggle', ms: 820 };
  if (!path) return { pose: 'stand', ...nod };
  if (path.endsWith('/book')) return { pose: 'point', ...nod };
  if (path.endsWith('/goods')) return { pose: 'spread', ...wig };
  if (path.endsWith('/settle')) return { pose: 'cheer', trick: 'hop', ms: 760 };
  if (path.endsWith('/archive')) return { pose: 'fold', ...nod };
  if (path.endsWith('/team')) return { pose: 'wave', ...wig };
  if (path.endsWith('/add')) return { pose: 'open', ...nod };
  if (path.startsWith('/teams/new')) return { pose: 'gasp', ...nod };
  if (path.startsWith('/teams')) return { pose: 'open', ...nod };
  if (path.startsWith('/login') || path.startsWith('/join')) return { pose: 'wave', ...wig };
  if (path.startsWith('/l/')) return { pose: 'smile', ...nod };
  return { pose: 'stand', ...nod };
}

/**
 * 커피 사주기.
 *
 * 계좌를 그대로 두는 쪽이 제일 확실하다. 개인 송금 링크(toss.me 같은 것)는
 * 서비스가 닫히면 그날로 죽은 링크가 되지만, 계좌번호는 은행이 있는 한 산다.
 * 후원 페이지 주소가 따로 있으면 그것도 함께 둔다.
 */
/** 이 화면에서 무엇을 할 수 있는지. 탭을 옮길 때마다 길잡이가 한 번 알려 준다. */
function tipFor(path: string | null): Key | null {
  if (!path) return null;
  if (path.endsWith('/book')) return 'tipBook';
  if (path.endsWith('/goods')) return 'tipGoods';
  if (path.endsWith('/settle')) return 'tipSettle';
  if (path.endsWith('/archive')) return 'tipArchive';
  if (path.endsWith('/team')) return 'tipTeam';
  if (path.endsWith('/add')) return 'tipAdd';
  if (path.startsWith('/teams')) return 'tipTeams';
  if (path.startsWith('/login') || path.startsWith('/join')) return 'tipLogin';
  if (path.startsWith('/l/')) return 'tipHome';
  return null; // 첫 화면에는 볼 것이 두 줄뿐이다. 거기서는 아무 말도 하지 않는다.
}

/**
 * 말할 때의 자세. 한 줄마다 하나씩 차례로 쓴다.
 * 줄이 바뀌는데 몸이 그대로면 녹음을 틀어 놓은 것처럼 보인다.
 * 무작위가 아니라 줄 번호로 정해서, 같은 말에는 늘 같은 몸짓이 붙는다.
 */
const SAY_POSES = ['point', 'wave', 'spread', 'smile', 'open'] as const;

/**
 * 일상적인 말에 붙는 자세. i18n의 chat 줄 순서와 하나씩 짝을 이룬다.
 *
 * "가끔은 접혀서 자고 싶어요"를 팔 벌리고 서서 말하면 말과 몸이 따로 논다.
 * 그 줄에는 누운 모습이어야 한다. 말이 곧 자세다.
 */
const CHAT_POSES = [
  'lean',    // 종이라서 바람에는 좀 약해요
  'point',   // 저 위의 점을 누르시면
  'crumple', // 구겨져도 적힌 건 안 없어져요
  'fold',    // 계산은 장부가 해요
  'spread',  // 저를 끌어서 아무 데나
  'gasp',    // 돈 얘기는 미루면 더 어려워져요
  'stand',   // 영수증은 버리면 끝이지만 장부는 남아요
  'flat',    // 가끔은 접혀서 자고 싶어요
  'smile',   // 천천히 보셔도 돼요
  'shy',     // 잉크가 마르면 흐려져요
  'brace',   // 누가 얼마 냈는지는 안 잊어요
  'hit',     // 숫자가 안 맞으면 제가 먼저 놀랄 거예요
] as const;

/**
 * 아무 말도 안 할 때의 자세. 여기서만 천천히 오간다.
 * 서 있는 모습 몇 가지라 팔의 위치만 달라지는 정도다.
 */
const REST_POSES = ['stand', 'smile', 'shy', 'spread', 'point', 'brace'] as const;

/**
 * 들려서 옮겨질 때의 자세.
 *
 * 어느 쪽으로 얼마나 빨리 움직이느냐가 자세를 정한다. 위로 채면 뛰어오른
 * 모습, 아래로 떨구면 떨어지는 모습, 옆으로 끌면 기운 모습. 무작위로
 * 고르면 손의 움직임과 몸이 따로 놀아서 인형을 흔드는 것처럼 보인다.
 */
function heldPose(dx: number, dy: number, speed: number, wobbly: boolean): string {
  if (speed < 1.5) return 'brace';        // 들고 가만히 — 팔로 버틴다
  if (wobbly) return 'hit';               // 방향을 자주 바꾼다 — 놀란다
  const up = dy < -Math.abs(dx) * 0.6;
  const down = dy > Math.abs(dx) * 0.6;
  const sideways = !up && !down;

  if (speed > 60) return sideways ? 'coil' : 'twist';   // 휙 채면 몸이 꼬인다
  if (speed > 34) {
    if (up) return 'leap';
    if (down) return 'squash';
    return dx < 0 ? 'swoop' : 'sail';                   // 옆으로 날아간다
  }
  if (speed > 16) {
    if (up) return 'jump';
    if (down) return 'dive';
    return 'skid';                                       // 옆으로 미끄러진다
  }
  if (up) return 'cheer';
  if (down) return 'fold';
  return dx < 0 ? 'point' : 'wave';
}

const COFFEE = process.env.NEXT_PUBLIC_COFFEE_URL;
const COFFEE_ACCOUNT = process.env.NEXT_PUBLIC_COFFEE_ACCOUNT;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function Helper({ lang }: { lang: Locale }) {
  // 렌더마다 새로 만들면 아래 타이머가 매번 처음부터 다시 돈다. 붙잡아 둔다.
  const T = useMemo(() => translator(lang), [lang]);
  const ctx = useHelperLine();
  const line = ctx?.line ?? null;
  const path = usePathname();

  const ledgerId = path?.startsWith('/l/') ? (path.split('/')[2] ?? null) : null;

  const [hidden, setHidden] = useState(false);
  const [pose, setPose] = useState('stand');
  const [trick, setTrick] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [unread, setUnread] = useState(false);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [coffee, setCoffee] = useState(false);
  const [tip, setTip] = useState<Key | null>(null);
  /** 안내는 한 번에 한 줄씩. 지금 몇 번째 줄인가. -1이면 쉬는 참. */
  const [tipAt, setTipAt] = useState(-1);
  const [placed, setPlaced] = useState(false);
  /** 말이 어느 쪽에 붙는가. 왼쪽이 기본이고, 화면 왼쪽에 붙어 있으면 오른쪽. */
  const [sayRight, setSayRight] = useState(false);
  const [copied, setCopied] = useState(false);
  const [held, setHeld] = useState(false);
  /** 버리는 중 — 구겨지며 사라지는 3초 동안 */
  const [tossing, setTossing] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const lastSeen = useRef(Date.now());
  const trickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** 사람이 열어 둔 상태인가. 탭을 옮길 때 그대로 둘지 판단한다. */
  const menuRef = useRef(false);
  const restPose = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 버리는 중의 시계. 말하는 시계(timers)와 섞이면 도중에 지워진다. */
  const tossTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 물리 — 몸(pos)이 목표(aim)를 용수철로 따라간다. */
  const pos = useRef({ x: -1, y: -1 });
  const vel = useRef({ x: 0, y: 0 });
  const aim = useRef({ x: -1, y: -1 });
  const dragging = useRef(false);
  const dragPose = useRef('');
  const flips = useRef(0);
  const lastSign = useRef(0);
  const sideRef = useRef(false);
  const restT = useRef(0);

  /** 자세 하나와 움직임 하나를 한 번 보여 주고, 잠시 뒤 서 있는 자세로 돌아온다. */
  const play = useCallback((poseName: string, name: string, ms: number, back = true) => {
    setPose(poseName);
    setTrick(name);
    if (trickTimer.current) clearTimeout(trickTimer.current);
    trickTimer.current = setTimeout(() => setTrick(null), ms);
    if (restPose.current) clearTimeout(restPose.current);
    if (back) restPose.current = setTimeout(() => setPose('stand'), ms + 900);
  }, []);

  const remember = useCallback((v: string) => {
    try {
      localStorage.setItem(SPOT_KEY, v);
    } catch {
      /* 못 적어도 이번 화면에서는 잘 돈다 */
    }
  }, []);

  /* 처음 자리 — 오른쪽 아래. 기억해 둔 자리가 있으면 그리로.
     그리기 전에(useLayoutEffect) 잡아야 한다. 그리고 나서 잡으면 왼쪽 위에
     한 번 나타났다가 제자리로 뛰어가는 게 보인다. */
  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(HIDE_KEY) === '1') setHidden(true);
    } catch {
      /* 저장을 막아 두었으면 그냥 보인다 */
    }
    const roomX = Math.max(6, window.innerWidth - W - 6);
    const roomY = Math.max(TOP_ROOM, window.innerHeight - H - 6);
    let x = roomX - 20;
    let y = roomY - 16;
    try {
      const s = localStorage.getItem(SPOT_KEY);
      if (s) {
        const v = JSON.parse(s) as { right: number; bottom: number };
        // 창 크기가 달라진 뒤에 열면 지난번 자리가 화면 밖을 가리킬 수 있다.
        // 그럴 땐 기억을 버리고 기본 자리로 선다. 구석에 박혀 못 나오는 것보다 낫다.
        const fits =
          Number.isFinite(v.right) && Number.isFinite(v.bottom) &&
          v.right >= 0 && v.right <= window.innerWidth - W &&
          v.bottom >= 0 && v.bottom <= window.innerHeight - H;
        if (fits) {
          x = window.innerWidth - W - v.right;
          y = window.innerHeight - H - v.bottom;
        }
      }
    } catch {
      /* 값이 깨졌으면 기본 자리 */
    }
    x = clamp(x, 6, roomX);
    y = clamp(y, TOP_ROOM, roomY);
    pos.current = { x, y };
    aim.current = { x, y };
    if (root.current) {
      root.current.style.left = `${Math.round(x)}px`;
      root.current.style.top = `${Math.round(y)}px`;
    }
    setPlaced(true);
  }, []);

  /* 매 프레임 — 용수철로 따라가고, 숨 쉬듯 들썩인다. */
  useEffect(() => {
    if (hidden) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const t0 = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const el = root.current;
      if (!el || pos.current.x < 0) return;

      const p = pos.current;
      const a = aim.current;
      const v = vel.current;

      if (still) {
        p.x = a.x;
        p.y = a.y;
        v.x = v.y = 0;
      } else {
        v.x = (v.x + (a.x - p.x) * 0.16) * 0.82;
        v.y = (v.y + (a.y - p.y) * 0.16) * 0.82;
        p.x += v.x;
        p.y += v.y;
      }

      // 용수철은 목표를 지나쳤다가 돌아온다. 그 지나침이 화면 밖으로 나가면
      // 구석에 박혀 다시 못 나온다. 벽에 닿으면 거기서 멈추고 속도도 죽인다.
      const wallX = Math.max(6, window.innerWidth - W - 6);
      const wallY = Math.max(TOP_ROOM, window.innerHeight - H - 6);
      if (p.x < 6) { p.x = 6; v.x = 0; }
      if (p.x > wallX) { p.x = wallX; v.x = 0; }
      if (p.y < TOP_ROOM) { p.y = TOP_ROOM; v.y = 0; }
      if (p.y > wallY) { p.y = wallY; v.y = 0; }

      el.style.left = `${Math.round(p.x)}px`;
      el.style.top = `${Math.round(p.y)}px`;

      const inner = tilt.current;
      if (inner) {
        // 가로로 빨리 움직이면 그만큼 기운다. 종이 한 장이라 잘 휘청인다.
        const lean = still ? 0 : clamp(-v.x * 0.8, -10, 10);
        // 서 있는 동안의 들썩임. 주기가 다른 둘을 겹쳐 규칙이 안 보이게 한다.
        const t = (now - t0) / 1000;
        const bob = still || dragging.current ? 0 : Math.sin(t * 1.5) * 0.9 + Math.sin(t * 0.8) * 0.6;
        const breath = still ? 1 : 1 + Math.sin(t * 1.5) * 0.008;
        inner.style.transform = `translateY(${bob.toFixed(2)}px) rotate(${lean.toFixed(2)}deg) scaleY(${breath.toFixed(3)})`;
      }

      // 말은 자리가 남는 쪽에 붙인다. 왼쪽에 서 있으면 오른쪽에, 오른쪽에
      // 서 있으면 왼쪽에. 넓은 쪽이 곧 글이 들어갈 자리다.
      const wantRight = p.x + W / 2 < window.innerWidth / 2;
      if (wantRight !== sideRef.current) {
        sideRef.current = wantRight;
        setSayRight(wantRight);
      }

      const asleep = Math.abs(v.x) < 0.05 && Math.abs(v.y) < 0.05;
      if (asleep && now - restT.current > 900 && !dragging.current) {
        restT.current = now;
        remember(
          JSON.stringify({
            right: Math.round(window.innerWidth - W - p.x),
            bottom: Math.round(window.innerHeight - H - p.y),
          }),
        );
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [hidden, remember]);

  /* 창 크기가 바뀌면 화면 밖으로 나가지 않게 끌어들인다. */
  useEffect(() => {
    const fit = () => {
      const rx = Math.max(6, window.innerWidth - W - 6);
      const ry = Math.max(TOP_ROOM, window.innerHeight - H - 6);
      aim.current.x = clamp(aim.current.x, 6, rx);
      aim.current.y = clamp(aim.current.y, TOP_ROOM, ry);
      // 몸도 같이 끌어들인다. 목표만 고치면 몸은 화면 밖에 남는다.
      pos.current.x = clamp(pos.current.x, 6, rx);
      pos.current.y = clamp(pos.current.y, TOP_ROOM, ry);
    };
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  /* 사람이 화면을 내리면 같이 기운다. 옆에 서 있는 것이 아니라 함께 보고 있다. */
  useEffect(() => {
    if (hidden) return;
    let cool = 0;
    const onScroll = () => {
      lastSeen.current = Date.now();
      const now = Date.now();
      if (now - cool < 2600 || dragging.current || open) return;
      cool = now;
      play('lean', 'wiggle', 820);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [hidden, open, play]);

  /* 화면을 옮기면 그 화면에 맞게 한 번 인사한다. */
  useEffect(() => {
    lastSeen.current = Date.now();
    const g = greetFor(path);
    play(g.pose, g.trick, g.ms);

    // 이 화면에서 무엇을 할 수 있는지 일러 준다. 길잡이가 하는 일이다.
    //
    // 사람이 열어 둔 말풍선은 건드리지 않는다. 탭을 옮겼다고 손에 들고 있던
    // 것이 닫히면, 옮길 때마다 다시 열어야 한다.
    setTip(tipFor(path));
    setTipAt(0);
    setOpen((was) => (menuRef.current ? was : false));
  }, [path, play]);

  /**
   * 할 말.
   *
   * 그 화면의 안내가 먼저 나오고, 다 하고 나면 일상적인 말이 이어진다.
   * 말이 떨어져 조용해지면 옆에 붙여 놓은 그림이 되기 때문에, 끊지 않는다.
   * 일상적인 말은 시작 지점을 매번 달리 잡아, 늘 같은 순서로 들리지 않게 한다.
   */
  const script = useMemo(() => {
    const tips = tip ? T(tip).split('\n') : [];
    const small = T('chat').split('\n');
    return { tips, small };
  }, [tip, T]);
  const seed = useRef(Math.floor(Math.random() * 97));
  /** 사람이 말풍선을 닫은 뒤 잠시 쉬는 참. 닫자마자 다시 말하면 무례하다. */
  const hushUntil = useRef(0);

  /** 몇 번째 말인가 → 그 말과 그때의 자세. 둘은 한 짝이다. */
  const sayAt = useCallback(
    (i: number): { text: string; pose: string } | null => {
      // 쉬는 참(-1)에는 할 말이 없다. 여기서 막지 않으면 tips[-1] 이 넘어가서
      // 빈 말풍선이 뜨고, 짝이 되는 자세도 없어 그림이 사라진다.
      if (i < 0) return null;
      const { tips, small } = script;
      if (i < tips.length) {
        return { text: tips[i], pose: SAY_POSES[i % SAY_POSES.length] };
      }
      if (!small.length) return null;
      const j = (i - tips.length + seed.current) % small.length;
      return { text: small[j], pose: CHAT_POSES[j % CHAT_POSES.length] };
    },
    [script],
  );

  /*
   * 한 번에 한 줄씩 말한다.
   *
   * 할 말을 한꺼번에 쏟아 놓으면 읽히지 않고 화면만 가린다. 다섯 셀 동안
   * 한 줄을 보이고, 두 셀 쉬고, 다음 줄. 말이 바뀌면 몸도 같이 바뀐다.
   * 사람이 점을 눌러 말풍선을 열면 이 순서는 멈춘다 — 그때는 사람 차례다.
   */
  useEffect(() => {
    if (menu || coffee || asking || line) return;
    const say = sayAt(tipAt);
    if (!say) return;

    // 방금 사람이 닫았으면 조금 기다렸다가 다시 말한다.
    const wait = hushUntil.current - Date.now();
    if (wait > 0) {
      const hold = setTimeout(() => setTipAt((i) => i + 1), wait);
      timers.current.push(hold);
      return () => clearTimeout(hold);
    }

    setOpen(true);
    // 자세는 그 줄에 붙어 있는 것을 쓴다. 말과 몸은 한 짝이다.
    play(say.pose, tipAt % 2 ? 'wiggle' : 'nod', tipAt % 2 ? 820 : 620, false);

    const hide = setTimeout(() => {
      setOpen(false);
      // 잠깐 사라졌다가 다음 줄. 그 틈이 있어야 새 말이라는 게 보인다.
      const next = setTimeout(() => setTipAt((i) => i + 1), 2000);
      timers.current.push(next);
    }, 5000);
    timers.current.push(hide);
    return () => {
      clearTimeout(hide);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [tipAt, menu, coffee, asking, line, sayAt, play]);

  /* 할 말이 생기면 손을 흔든다. 말풍선은 스스로 열지 않는다. */
  useEffect(() => {
    if (!line) return;
    lastSeen.current = Date.now();
    setUnread(true);
    setMenu(false);
    setAsking(false);
    play('gasp', 'wiggle', 820); // 놀란다. 무슨 일이 났다는 뜻이다.
  }, [line, play]);

  /*
   * 조용할 때.
   *
   * 아무 말도 안 하는 동안에도 완전히 굳어 있으면 붙여 놓은 그림이 된다.
   * 그래서 몇 초에 한 번 자세를 옮긴다. 팔의 위치가 달라지는 정도지 큰
   * 동작은 아니다. 오래 조용하면 웅크렸다가, 더 오래면 아예 눕는다.
   */
  useEffect(() => {
    if (hidden) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const beat = () => {
      if (!alive) return;
      const quiet = Date.now() - lastSeen.current;

      if (!open && !dragging.current) {
        if (quiet > 40_000) setPose('crumple');
        else if (quiet > 10_000) setPose('flat');
        else if (!still) {
          setPose((p) => {
            const pool = REST_POSES.filter((x) => x !== p);
            return pool[Math.floor(Math.random() * pool.length)];
          });
          setTrick('nod');
          setTimeout(() => alive && setTrick(null), 620);
        }
      }
      timer = setTimeout(beat, 5200 + Math.random() * 3600);
    };

    timer = setTimeout(beat, 4200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [hidden, open]);

  /* ── 몸을 잡으면 그대로 끌려온다 ─────────────────────────────────── */
  function onGrab(e: React.PointerEvent) {
    e.preventDefault();
    lastSeen.current = Date.now();
    const grabX = e.clientX - pos.current.x;
    const grabY = e.clientY - pos.current.y;
    const from = { x: e.clientX, y: e.clientY };
    const last = { x: e.clientX, y: e.clientY };
    flips.current = 0;
    lastSign.current = 0;
    let moved = false;

    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - from.x) + Math.abs(ev.clientY - from.y) < DRAG_SLOP) return;
      if (!moved) {
        moved = true;
        dragging.current = true;
        setHeld(true);
        if (restPose.current) clearTimeout(restPose.current);
        setPose('spread'); // 들리면 팔을 벌린다
        setTrick(null);
      }
      // 어느 쪽으로 얼마나 빨리 움직이는지가 몸을 정한다.
      const dx = ev.clientX - last.x;
      const dy = ev.clientY - last.y;
      const speed = Math.abs(dx) + Math.abs(dy);
      // 방향이 자주 뒤집히면 흔들리는 것이다.
      if (dx !== 0) {
        const sign = dx > 0 ? 1 : -1;
        if (sign !== lastSign.current) flips.current += 1;
        else flips.current = Math.max(0, flips.current - 0.6);
        lastSign.current = sign;
      }
      last.x = ev.clientX;
      last.y = ev.clientY;

      const want = heldPose(dx, dy, speed, flips.current > 5);
      if (want !== dragPose.current) {
        dragPose.current = want;
        setPose(want);
      }
      aim.current = {
        x: clamp(ev.clientX - grabX, 6, Math.max(6, window.innerWidth - W - 6)),
        y: clamp(ev.clientY - grabY, TOP_ROOM, Math.max(TOP_ROOM, window.innerHeight - H - 6)),
      };
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (moved) {
        dragging.current = false;
        dragPose.current = '';
        setHeld(false);
        // 손을 놓으면 지나쳤다가 돌아온다. 스프링이 알아서 한다.
        play('leap', 'hop', 760);
      } else {
        // 그냥 툭 건드린 것. 맞은 것처럼 팔로 얼굴을 가리며 움찔한다.
        play('tuck', 'wiggle', 620);
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /* ── 머리 위 단추 — 말풍선을 열고 닫는다 ─────────────────────────── */
  function toggle() {
    lastSeen.current = Date.now();
    if (open) {
      setOpen(false);
      setMenu(false);
      setAsking(false);
      setCoffee(false);
      hushUntil.current = Date.now() + 7000; // 닫았으니 잠깐 쉬었다가 이어 간다
      setPose('stand');
      if (unread) {
        setUnread(false);
        ctx?.hush();
      }
      return;
    }
    setOpen(true);
    setUnread(false);
    hushUntil.current = Date.now() + 7000; // 사람 차례다. 그동안은 말하지 않는다
    setMenu(!line);
    setAsking(false);
    setCoffee(false);
    if (restPose.current) clearTimeout(restPose.current);
    setPose('point'); // 말하는 중
  }

  /* 치웠을 때 — 그림과 이름을 함께 둔다. 글씨만 두면 못 찾는다. */
  if (hidden) {
    return (
      <button
        className="helper-back"
        onClick={() => {
          setHidden(false);
          try {
            localStorage.setItem(HIDE_KEY, '0');
          } catch {
            /* 저장을 막아 두었으면 이번 화면에서만 돌아온다 */
          }
        }}
      >
        <img src="/helper/stand.png" alt="" />
        <span>{T('helperShow')}</span>
      </button>
    );
  }

  // 사람이 연 것(메뉴·커피)인지 길잡이가 말하는 중인지 기억해 둔다.
  menuRef.current = menu || coffee;

  const bubble = !open ? null : line ? line.text : (sayAt(tipAt)?.text ?? null);

  return (
    <div
      ref={root}
      className={`helper${held ? ' held' : ''}${placed ? ' placed' : ''}${tossing ? ' tossing' : ''}`}
      aria-hidden={tossing || undefined}
    >
      {/* 말 — 옆에, 상자 없이. 장부 위에 연필로 적어 둔 것처럼 얹힌다. */}
      {open && bubble && !menu && !coffee && (
        <p className={`helper-say${line ? ' warn' : ''}${sayRight ? ' right' : ''}`}>{bubble}</p>
      )}

      {/* 할 수 있는 일 — 머리 위 점에서 자라 나오는 말풍선 안에. */}
      {open && (menu || coffee) && (
        <div className={`helper-bubble${sayRight ? ' right' : ''}`}>
          {menu && !coffee && (
            <div className="say-menu">
              {ledgerId && (
                <button className="plain" onClick={() => { setAsking(true); setOpen(false); }}>
                  {T('helperAsk')}
                </button>
              )}
              {/* 커피는 어느 화면에서나 있다. 장부와 상관없는 일이라서. */}
              {(COFFEE_ACCOUNT || COFFEE) && (
                <button
                  className="plain"
                  onClick={() => { setCoffee(true); setMenu(false); setPose('cheer'); }}
                >
                  {T('helperCoffee')}
                </button>
              )}
              <button
                className="plain"
                onClick={() => {
                  // 버리는 데에도 시간이 든다. 종이를 구겨서 던지듯,
                  // 3초 동안 구겨지고 옅어진 다음에 자리를 뜬다.
                  setMenu(false);
                  setOpen(false);
                  setTrick(null);
                  setPose('crumple');
                  setTossing(true);
                  if (tossTimer.current) clearTimeout(tossTimer.current);
                  tossTimer.current = setTimeout(() => {
                      setTossing(false);
                      setHidden(true);
                      try {
                        localStorage.setItem(HIDE_KEY, '1');
                      } catch {
                        /* 저장을 못 해도 이번 화면에서는 치워진다 */
                      }
                  }, 3000);
                }}
              >
                {T('helperHide')}
              </button>
            </div>
          )}

          {coffee && (
            <div className="say-menu">
              {COFFEE_ACCOUNT && (
                <>
                  <span className="remit-to">
                    <button
                      className="acct num"
                      title={T('copyAccount')}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(COFFEE_ACCOUNT);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        } catch {
                          // 복사가 막혀 있으면 계좌가 화면에 그대로 있다.
                        }
                      }}
                    >
                      {COFFEE_ACCOUNT}
                      {copied && <span className="acct-done"> {T('copied')}</span>}
                    </button>
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>{T('coffeeThanks')}</span>
                </>
              )}
              {COFFEE && (
                <a className="plain" href={COFFEE} target="_blank" rel="noreferrer noopener">
                  {T('coffeePage')}
                </a>
              )}
            </div>
          )}

        </div>
      )}

      {/* 장부에 대해 묻는 창. 말풍선 안에 넣기엔 대답이 길다. */}
      {asking && ledgerId && (
        <AskPanel
          ledgerId={ledgerId}
          lang={lang}
          onClose={() => { setAsking(false); play('stand', 'nod', 620); }}
          onBusy={(state) => {
            lastSeen.current = Date.now();
            if (state === 'reading') setPose('fold');
            else if (state === 'answered') setPose('smile');
            else setPose('shy');
          }}
        />
      )}

      {/* 머리 위 단추. 말풍선은 여기서만 열고 닫는다.
          검은 선으로 그린 흰 원 하나 — 말풍선을 가장 적게 줄인 모양이다. */}
      <button
        className={`helper-tab${open ? ' on' : ''}${unread ? ' unread' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-label={T('helperTitle')}
        title={T('helperTitle')}
      >
        <i aria-hidden="true" />
      </button>

      {/* 그림자는 기울지도 뛰지도 않는다. 바닥은 제자리에 있어야 바닥이다. */}
      <div className="stage">
        <span className="helper-shade" aria-hidden="true" />
        <div className="tilt" ref={tilt}>
          {/* 몸은 잡아서 옮기는 자리다. */}
          <div
            className={`helper-body${trick ? ` t-${trick}` : ''}`}
            onPointerDown={onGrab}
            role="presentation"
          >
            <img src={`/helper/${pose}.png`} alt="" draggable={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
