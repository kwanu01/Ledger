'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useHelperLine } from './HelperContext.tsx';
import AskPanel from './AskPanel.tsx';
import { translator, type Key } from '../../lib/i18n.ts';
import type { Locale } from '../../lib/domain/money.ts';

/**
 * 수증이 (§21.10)
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
  if (path.endsWith('/archive')) return { pose: 'tuck', ...nod };
  if (path.endsWith('/team')) return { pose: 'wave', ...wig };
  if (path.endsWith('/add')) return { pose: 'open', ...nod };
  if (path.startsWith('/teams/new')) return { pose: 'gasp', ...nod };
  if (path.startsWith('/teams')) return { pose: 'bow', ...nod };
  if (path.startsWith('/login') || path.startsWith('/join')) return { pose: 'wave', ...wig };
  if (path.startsWith('/l/')) return { pose: 'lean', ...nod };
  return { pose: 'stand', ...nod };
}

/** 이 화면에서 무엇을 할 수 있는지. 탭을 옮길 때마다 수증이가 한 번 알려 준다. */
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
  // 첫 화면. 처음 온 사람은 여기가 무엇을 하는 곳인지부터 알아야 한다.
  // 그 설명이 끝나면 일상적인 말로 이어진다(chat).
  if (path === '/') return 'tipLanding';
  return null;
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
  'wave',    // 저는 수증이예요. 영수증이라 바람에는 좀 약해요 (인사)
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
  'float',   // …나는 영수증 유령이다
  'bow',     // 오셨네요. 장부는 그대로 있어요
  'curl',    // 주머니에 오래 있으면 이렇게 말려요
  'flop',    // 오늘은 좀 눌린 것 같아요
  'tip',     // 똑바로 서 있는 게 생각보다 어려워요
  'tuck',    // 여기 접어 두면 그 자리부터 펴져요
  'twist',   // 비에 젖었다 마르면 이렇게 돼요
  'lean',    // 잠깐만 기대 있을게요
  'coil',    // 오래 말려 있으면 자꾸 돌아가요
  'sleep',   // 조용하면 저는 잠깐 자요
  'squash',  // 눌려도 괜찮아요. 숫자는 안 눌려요
  'curl',    // 영수증은 남으라고 만든 게 아닌데, 저는 남았네요
] as const;

/**
 * 놓았을 때 내려앉는 방식.
 *
 * 한 가지만 두었더니 옮길 때마다 같은 동작이 나와서, 두어 번 만에 '반응'이
 * 아니라 '재생'으로 보였다. 종이 한 장이 떨어지는 방식은 원래 한 가지가
 * 아니다 — 눌리기도 하고, 공기를 타고 흐르기도 하고, 비틀렸다 풀리기도 한다.
 *
 * 자세와 몸짓은 한 짝이다. 미끄러지는 몸짓(slide)에는 미끄러지다 멈춘
 * 자세(skid)를 붙여야 그림과 움직임이 같은 말을 한다.
 */
const LANDINGS = [
  { pose: 'leap', trick: 'hop', ms: 760 },    // 지나쳤다가 돌아온다
  { pose: 'squash', trick: 'thud', ms: 660 }, // 눌렸다 펴진다
  { pose: 'sail', trick: 'glide', ms: 920 },  // 공기를 타고 흐른다
  { pose: 'twist', trick: 'spin', ms: 780 },  // 비틀렸다 풀린다
  { pose: 'skid', trick: 'slide', ms: 700 },  // 미끄러지다 선다
  { pose: 'flop', trick: 'flap', ms: 880 },   // 폭 꺾였다 일어선다
] as const;

/**
 * 아무 말도 안 할 때의 자세. 여기서만 천천히 오간다.
 * 서 있는 모습 몇 가지라 팔의 위치만 달라지는 정도다.
 */
const REST_POSES = [
  'stand', 'smile', 'shy', 'spread', 'point', 'brace',
  // 서 있는 모습만 여섯이면 오래 보고 있을 때 한 바퀴가 금방 돈다. 기대거나
  // 숙이거나 귀퉁이가 접힌 모습을 섞어 둔다 — 전부 서 있는 자세라서 갑자기
  // 누웠다 일어나는 것처럼 보이지 않는다.
  'bow', 'lean', 'open', 'fold', 'tuck', 'wave',
] as const;

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

/**
 * 처음 설 자리 (§21.10)
 *
 * 오른쪽 아래 구석이 기본이지만, 좁은 화면에서는 거기에 이미 글이 있다.
 * 종이 한 장이 글씨 위에 얹혀 있으면 읽는 사람만 성가시다.
 *
 * 처음에는 몇 군데를 골라 놓고 그 점 위에 무엇이 있는지 물어봤다(elementFromPoint).
 * 그 방법은 두 군데서 틀렸다.
 *
 *   하나, **점 몇 개로는 겹침을 못 잡는다.** 네 점이 다 비어 있어도 그 사이로
 *   글줄이 지나간다. 화면 맨 아래 줄(Ledger 2026 · 개인정보 처리방침 · 문의)이
 *   정확히 그렇게 가려졌다.
 *
 *   둘, **글의 사각형이 아니라 칸의 사각형을 봤다.** "바로 나누기 … 가입 없이"는
 *   한 줄을 다 차지하는 것처럼 보이지만, 실제 글씨는 양 끝에만 있고 가운데는 비어
 *   있다. 칸으로 보면 설 자리가 한 군데도 없다는 결론이 나온다.
 *
 * 그래서 지금은 **글자가 실제로 그려진 사각형**을 모은다. 텍스트 노드마다 Range를
 * 잡아 getClientRects()를 부르면 글줄 하나하나의 상자가 나온다. 그림·입력칸처럼
 * 글이 아닌 것은 요소의 상자를 그대로 쓴다.
 *
 * 그 위에서 자리를 훑고, **겹친 넓이가 가장 작은 자리**에 선다. 완전히 빈 자리가
 * 없는 화면도 있기 때문에 "빈 자리가 있으면 거기, 없으면 제일 덜 가리는 자리"로
 * 둔다. 같은 값이면 원래 자리인 오른쪽 아래를 고르도록 거리에 약간의 벌점을 준다.
 */

/** .helper .stage 의 margin-top. 그림은 뿌리 상자의 이 아래부터 그려진다. */
const ART_TOP = 26;
const ART_H = 156;

/**
 * 뿌리 상자와 실제로 그려지는 상자는 다르다.
 *
 * 좁은 화면에서 수증이는 `transform:scale(.72)` 로 작아지고, 그 기준점이
 * 오른쪽 아래(100% 100%)다. 그래서 left/top 으로 세워 둔 자리와 눈에 보이는
 * 자리가 가로 44px, 세로 53px 어긋난다. 겹침을 left/top 으로 재면 딱 그만큼
 * 틀린 자리를 재게 되고, 화면 맨 아래 줄이 가려진 것이 바로 그 차이였다.
 *
 * 배율과 기준점을 코드에 적어 두면 CSS를 고칠 때 또 어긋난다. 그래서 지금
 * 서 있는 요소에 직접 물어본다.
 */
type Metrics = { dx: number; dy: number; s: number; vw: number; vh: number };

function measure(el: HTMLElement): Metrics {
  const box = el.getBoundingClientRect();
  const left = parseFloat(el.style.left || '0');
  const top = parseFloat(el.style.top || '0');
  const s = box.width / W || 1;
  return { dx: box.left - left, dy: box.top - top, s, vw: box.width, vh: box.height };
}

/** 화면에 실제로 그려진 것들의 사각형. 글은 글줄 단위로, 나머지는 요소 단위로. */
function contentBoxes(): { l: number; t: number; r: number; b: number }[] {
  const out: { l: number; t: number; r: number; b: number }[] = [];
  const VW = window.innerWidth;
  const VH = window.innerHeight;

  const push = (r: DOMRect) => {
    if (r.width < 2 || r.height < 2) return;
    if (r.bottom < 0 || r.top > VH || r.right < 0 || r.left > VW) return;
    out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  };

  // 글줄
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.nodeValue?.trim()) continue;
    const parent = n.parentElement;
    if (!parent || parent.closest('.helper')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) push(rects[i]);
    range.detach?.();
  }

  // 글이 아닌 것 — 그림, 입력칸, 빈 단추
  document
    .querySelectorAll('img,svg,canvas,input,select,textarea,button,video')
    .forEach((el) => {
      if (el.closest('.helper')) return;
      push(el.getBoundingClientRect());
    });

  return out;
}

/** 이 자리에 서면 무엇을 얼마나 가리는가(넓이, px²). 0이면 아무것도 안 가린다. */
function overlapAt(
  boxes: { l: number; t: number; r: number; b: number }[],
  m: Metrics,
  x: number,
  y: number,
): number {
  // 뿌리 상자가 아니라 **그림이 실제로 그려지는 칸**으로 잰다. 좌우로 조금은
  // 종이의 여백이라 글이 살짝 스쳐도 가려 보이지 않는다.
  // 스치는 것도 겹친 것으로 센다. 글자 끝에서 1px 떨어져 서면 수치로는
  // 안 가린 것이지만 눈으로는 붙어 있다. 사방으로 조금 부풀려서 잰다.
  const graze = 7;
  const pad = 5 * m.s;
  const l = x + m.dx + pad - graze;
  const r = x + m.dx + m.vw - pad + graze;
  const t = y + m.dy + ART_TOP * m.s - graze;
  const b = t + ART_H * m.s + graze * 2;

  let sum = 0;
  for (const q of boxes) {
    const w = Math.min(r, q.r) - Math.max(l, q.l);
    const h = Math.min(b, q.b) - Math.max(t, q.t);
    if (w > 0 && h > 0) sum += w * h;
  }
  return sum;
}

function freeSpot(
  boxes: { l: number; t: number; r: number; b: number }[],
  m: Metrics,
  topRoom: number,
): { x: number; y: number } {
  // 그림이 화면 밖으로 나가지 않는 마지막 자리. 재는 것도 세우는 것도
  // 눈에 보이는 상자를 기준으로 한다.
  const roomX = Math.max(6, window.innerWidth - 6 - m.dx - m.vw);
  const roomY = Math.max(topRoom, window.innerHeight - 6 - m.dy - m.vh);

  let best = { x: roomX - 20, y: roomY };
  let bestScore = Infinity;

  const stepX = Math.max(16, Math.round((roomX - 6) / 12));
  const stepY = 18;

  for (let y = roomY; y >= topRoom; y -= stepY) {
    for (let x = roomX; x >= 6; x -= stepX) {
      // 오른쪽 아래에서 멀어질수록 조금씩 손해. 같은 값이면 원래 자리에 선다.
      const bias = roomX - x + (roomY - y);
      const over = overlapAt(boxes, m, x, y);
      // 조금이라도 가리는 자리는 **비어 있는 자리보다 언제나 나쁘다.** 덜 가리는
      // 자리와 안 가리는 먼 자리를 같은 자로 재면, 글자를 조금 덮은 채로 가까이
      // 서는 쪽이 이긴다. 그게 지금까지 맨 아래 줄을 가리던 이유다.
      // 가리는 자리끼리만 넓이로 비교한다. 화면이 꽉 차 아무 데도 빈 자리가
      // 없을 때를 위한 순위다.
      const score = over > 0 ? 1_000_000 + over * 4 + bias : bias;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

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
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [tip, setTip] = useState<Key | null>(null);
  /** 안내는 한 번에 한 줄씩. 지금 몇 번째 줄인가. -1이면 쉬는 참. */
  const [tipAt, setTipAt] = useState(-1);
  const [placed, setPlaced] = useState(false);
  /** 말이 어느 쪽에 붙는가. 왼쪽이 기본이고, 화면 왼쪽에 붙어 있으면 오른쪽. */
  const [sayRight, setSayRight] = useState(false);
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
  /** 지금 열려 있는 창을 수증이가 스스로 열었는가. 그러면 스스로 닫는다. */
  const spoke = useRef(false);
  /** 직전에 쓴 착지. 연달아 같은 것이 나오면 안 고른 것처럼 보인다. */
  const lastLand = useRef(-1);

  const pickLanding = useCallback(() => {
    let i = Math.floor(Math.random() * LANDINGS.length);
    if (i === lastLand.current) i = (i + 1) % LANDINGS.length;
    lastLand.current = i;
    return i;
  }, []);
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
    // 좁은 화면에서는 그림이 작게 그려진다. 자리를 재는 것도 세우는 것도
    // 눈에 보이는 상자를 기준으로 해야 발끝이 화면 밖으로 안 나간다.
    const m: Metrics = root.current
      ? measure(root.current)
      : { dx: 0, dy: 0, s: 1, vw: W, vh: H };
    const roomX = Math.max(6, window.innerWidth - 6 - m.dx - m.vw);
    const roomY = Math.max(TOP_ROOM, window.innerHeight - 6 - m.dy - m.vh);
    // 기억해 둔 자리가 없으면 빈 자리를 찾아 선다.
    const boxes = contentBoxes();
    const first = freeSpot(boxes, m, TOP_ROOM);
    let x = first.x;
    let y = first.y;
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
          const rx = window.innerWidth - W - v.right;
          const ry = window.innerHeight - H - v.bottom;
          // 지난번에 세워 둔 자리라도 이 화면에서는 글을 가릴 수 있다.
          // 화면마다 글이 놓인 자리가 다르기 때문이다. 가리면 기억을 버린다.
          if (overlapAt(boxes, m, rx, ry) <= overlapAt(boxes, m, x, y)) {
            x = rx;
            y = ry;
          }
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

    // 이 화면에서 무엇을 할 수 있는지 일러 준다. 수증이가 하는 일이다.
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
    if (menu || asking || line) return;
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
  }, [tipAt, menu, asking, line, sayAt, play]);

  /*
   * 할 말이 생기면 손을 흔든다. 말풍선은 스스로 열지 않는다.
   *
   * 말이 자리를 가리키고 있으면(line.at) **그 옆으로 걸어간다.**
   * 되묻는 말은 어느 줄에 대한 말인지가 절반이라, 화면 구석에서 하면
   * 나머지 절반이 사라진다. 옆에 서서 말하면 가리키는 일과 말하는 일이
   * 한 번에 된다.
   *
   * 순간이동하지 않는다 — aim 만 옮기고 나머지는 용수철이 한다. 걸어가는
   * 동안 눈이 그 자리를 따라가므로, 도착했을 때 어디를 보라는 말이 필요 없다.
   */
  useEffect(() => {
    if (!line) {
      // 말이 지나갔다. 수증이가 열어 둔 창이면 스스로 닫고 하던 일로 돌아간다.
      // 사람이 열어 둔 창이면 그대로 둔다 — 사람이 닫을 창이다.
      if (spoke.current) {
        spoke.current = false;
        setOpen(false);
        setPose('stand');
      }
      return;
    }
    spoke.current = true;
    lastSeen.current = Date.now();
    /*
     * 말은 **스스로 열린다.**
     *
     * 전에는 손만 흔들고, 사람이 머리 위 점을 눌러야 무슨 말인지 보였다.
     * 그런데 이 말이 나오는 때는 대부분 방금 누른 단추가 안 먹은 때다 —
     * 왜 안 됐는지가 지금 필요한데, 그걸 보려고 한 번 더 눌러야 했다.
     *
     * 다섯 초 뒤에 말이 스스로 지나가고(HelperContext), 그러면 이 창도
     * 스스로 닫힌다. 사람이 치울 일이 없다.
     */
    setMenu(false);
    setAsking(false);
    setOpen(true);
    play('gasp', 'wiggle', 820); // 놀란다. 무슨 일이 났다는 뜻이다.

    const at = line.at;
    if (!at || hidden || dragging.current || !root.current) return;

    const m = measure(root.current);
    const roomX = Math.max(6, window.innerWidth - 6 - m.dx - m.vw);
    const roomY = Math.max(TOP_ROOM, window.innerHeight - 6 - m.dy - m.vh);

    // 누른 자리의 오른쪽에 선다. 오른쪽이 좁으면 왼쪽으로 간다.
    // 어느 쪽에 서든 말은 자리가 남는 쪽에 붙는다(sayRight).
    const right = at.x + at.w + 14 - m.dx;
    const left = at.x - m.vw - 14 - m.dx;
    const x = clamp(right + m.vw <= window.innerWidth - 6 ? right : left, 6, roomX);
    // 발끝이 그 줄에 닿게. 머리가 아니라 발이 기준이라 높이만큼 올린다.
    const y = clamp(at.y + at.h / 2 - m.vh + 30 - m.dy, TOP_ROOM, roomY);

    aim.current = { x, y };
  }, [line, play, hidden]);

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
        if (quiet > 40_000) setPose('sleep');
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
        // 손을 놓으면 지나쳤다가 돌아온다. 어떻게 내려앉는지는 그때마다 다르다.
        const land = LANDINGS[pickLanding()];
        play(land.pose, land.trick, land.ms);
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
      hushUntil.current = Date.now() + 7000; // 닫았으니 잠깐 쉬었다가 이어 간다
      setPose('stand');
      // 하던 말이 있으면 여기서 끝난다. 다시 보려고 눌러야 하는 말은 없다.
      if (line) ctx?.hush();
      return;
    }
    setOpen(true);
    spoke.current = false; // 사람이 연 창이다. 말이 지나가도 닫지 않는다.
    hushUntil.current = Date.now() + 7000; // 사람 차례다. 그동안은 말하지 않는다
    setMenu(!line);
    setAsking(false);
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

  // 사람이 연 메뉴인지 수증이가 말하는 중인지 기억해 둔다.
  menuRef.current = menu;

  const bubble = !open ? null : line ? line.text : (sayAt(tipAt)?.text ?? null);

  return (
    <div
      ref={root}
      className={`helper${held ? ' held' : ''}${placed ? ' placed' : ''}${tossing ? ' tossing' : ''}`}
      aria-hidden={tossing || undefined}
    >
      {/* 말 — 옆에, 상자 없이. 장부 위에 연필로 적어 둔 것처럼 얹힌다. */}
      {open && bubble && !menu && (
        <p className={`helper-say${line ? ' warn' : ''}${sayRight ? ' right' : ''}`}>{bubble}</p>
      )}

      {/* 할 수 있는 일 — 머리 위 점에서 자라 나오는 말풍선 안에. */}
      {open && menu && (
        <div className={`helper-bubble${sayRight ? ' right' : ''}`}>
          <div className="say-menu">
              {/*
                묻는 창은 장부 밖에서도 열린다.

                장부 안에서는 그 장부를 읽고 답하고, 밖에서는 서비스가 무엇인지
                답한다. 밖에서는 **장부 내용이 한 글자도 실리지 않는다** —
                로그인하지 않은 사람도 여는 자리라서, 실을 것이 있으면 그것부터
                새어 나간다.
              */}
              <button className="plain" onClick={() => { setAsking(true); setOpen(false); }}>
                {T(ledgerId ? 'helperAsk' : 'helperAskOpen')}
              </button>

              {/*
                장부 밖에서도 할 수 있는 것 (§21.10)

                '장부에 대해 묻기'는 장부가 있어야 한다. 그래서 첫 화면과
                로그인 화면에서는 말풍선을 열어도 '치우기' 하나뿐이었다 —
                말을 걸 수 있게 생겨서 눌렀는데 나갈 문만 있는 셈이다.

                화면마다 할 말은 이미 있다(tipFor). 스스로 한 줄씩 흘려 보내는
                그 말을 **사람이 부를 수 있게** 한다. 새 글을 쓰는 것이 아니라,
                이미 있는 말의 손잡이를 다는 것이다.
              */}
              <button
                className="plain"
                onClick={() => {
                  setMenu(false);
                  hushUntil.current = 0; // 불렀으니 쉬는 참은 끝이다
                  setTipAt(0); // 이 화면의 첫 줄부터 다시
                }}
              >
                {T('helperWhat')}
              </button>

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
        </div>
      )}

      {/* 장부에 대해 묻는 창. 말풍선 안에 넣기엔 대답이 길다. */}
      {asking && (
        <AskPanel
          ledgerId={ledgerId ?? undefined}
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
        className={`helper-tab${open ? ' on' : ''}`}
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
