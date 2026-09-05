/**
 * Ledger — 장부가 스스로 아는 것 (§11.4)
 *
 * 지출을 적을 때마다 사람은 같은 판단을 되풀이한다. 이건 무슨 분류지,
 * 누가 나눠 내지. 그런데 그 답은 대개 **이미 이 장부 안에 있다.**
 * 호미화방에서 산 것이 지난 세 번 다 재료비였고 다 같이 부담했다면,
 * 네 번째도 그럴 것이다.
 *
 * 이 파일이 하는 일이 그것이다. 규칙을 사람이 적어 두는 것이 아니라,
 * 적어 온 것에서 규칙을 읽는다.
 *
 * ── 왜 AI 를 안 부르는가
 *
 * 부를 이유가 없다. "지난 세 번 다 재료비"는 세는 일이지 판단하는 일이
 * 아니다. 세는 일을 모델에게 시키면 값이 들고, 느려지고, 무엇보다 **틀릴 수
 * 있다.** 이 장부의 규칙은 하나다 — 셀 수 있는 것은 서버가 세고, 모델은
 * 말만 한다(lib/ai/ask.ts).
 *
 * 그래서 이 파일은 순수 함수만 있다. 시뮬레이션에서 그대로 검증된다.
 *
 * ── 제안이지 결정이 아니다
 *
 * 값을 몰래 채워 넣지 않는다. **몇 번 중 몇 번이었는지를 함께** 돌려주고,
 * 화면은 그 근거를 사람에게 그대로 보여 준다. "지난 3번 중 3번 재료비"라고
 * 적힌 제안은 누를지 말지를 사람이 판단할 수 있지만, 조용히 채워진 '재료비'는
 * 확인할 방법이 없다. 장부에서 확인할 수 없는 값은 없는 값보다 나쁘다.
 */

import type { Allocation, Expense, Ledger, MemberId } from './types.ts';

/**
 * 되돌아볼 때 필요한 것만 추린 한 줄.
 *
 * 이 계산은 화면에서 돈다 — 판매처를 적는 순간 바로 제안이 떠야 하는데,
 * 글자 하나마다 서버에 물으면 그만큼 왕복이 생긴다. 그래서 장부를 화면으로
 * 내려보내야 하는데, **지출 전체를 통째로 내려보내지는 않는다.** 사진 경로와
 * 메모와 원통화 금액까지 딸려 가면 기입 화면 하나가 장부만큼 무거워진다.
 *
 * 세는 데 쓰는 칸만 간다. 금액도 안 간다 — 얼마였는지는 되풀이되는 값이 아니다.
 */
export type Recallable = Pick<
  Expense,
  'title' | 'vendor' | 'category' | 'allocation' | 'payerId' | 'group'
> & { isAdjustment?: boolean };

export function recallSeed(ledger: Ledger): Recallable[] {
  return ledger.expenses.map((e) => ({
    title: e.title,
    vendor: e.vendor,
    category: e.category,
    allocation: e.allocation,
    payerId: e.payerId,
    group: e.group,
    isAdjustment: e.adjustment ? true : undefined,
  }));
}

/** 이만큼은 쌓여야 제안한다. 한 번은 우연이고 두 번부터 버릇이다. */
const ENOUGH = 2;

/** 최근 것에 더 무게를 둔다. 이보다 오래된 것은 보지 않는다. */
const LOOK_BACK = 12;

export type Suggestion<T> = {
  value: T;
  /** 이 값이 나온 횟수 */
  times: number;
  /** 본 지출의 수 */
  of: number;
  /** 화면에 그대로 적을 수 있는 짧은 말. 사람이 읽을 언어는 화면이 붙인다. */
  sameVendor: boolean;
};

export type Recall = {
  /** 무엇을 근거로 찾았는가 — 판매처 이름, 없으면 항목 이름 */
  by: string;
  category?: Suggestion<string>;
  allocation?: Suggestion<Allocation>;
  payerId?: Suggestion<MemberId>;
  group?: Suggestion<string>;
};

/** 판매처·항목 이름 비교용. 띄어쓰기와 대소문자는 같은 가게를 다르게 보이게 한다. */
function flatten(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * 부담 방식을 셀 수 있는 열쇠로 바꾼다.
 *
 * 'all' 은 명단이 달라도 같은 뜻이다 — "그때 있던 사람 다"라는 뜻이라서.
 * 'partial' 은 누가 들어 있느냐가 곧 그 방식이므로 정렬해서 붙인다.
 * 'items' 는 세지 않는다. 영수증마다 품목이 다르므로 되풀이될 수가 없다.
 */
function keyOf(a: Allocation): string | null {
  switch (a.type) {
    case 'all':
      return 'all';
    case 'partial':
      return `partial:${[...a.participantIds].sort().join(',')}`;
    case 'personal':
      return `personal:${a.ownerId}`;
    case 'items':
      return null;
  }
}

/** 가장 많이 나온 값 하나. 같은 횟수면 최근 것이 이긴다(뒤에서부터 센다). */
function top<T>(
  rows: Recallable[],
  pick: (e: Recallable) => { key: string; value: T } | null,
  sameVendor: boolean,
): Suggestion<T> | undefined {
  const count = new Map<string, { value: T; times: number }>();
  let seen = 0;
  // 최근 것부터 본다. 동점일 때 최근 것이 앞에 서게 된다.
  for (const e of [...rows].reverse()) {
    const got = pick(e);
    if (!got) continue;
    seen += 1;
    const cell = count.get(got.key);
    if (cell) cell.times += 1;
    else count.set(got.key, { value: got.value, times: 1 });
  }
  if (seen === 0) return undefined;

  let best: { value: T; times: number } | undefined;
  for (const cell of count.values()) {
    if (!best || cell.times > best.times) best = cell;
  }
  if (!best || best.times < ENOUGH) return undefined;
  return { value: best.value, times: best.times, of: seen, sameVendor };
}

/**
 * 이 판매처(없으면 이 항목 이름)로 적어 온 것들에서 되풀이되는 값을 찾는다.
 *
 * 보정·환불 줄은 보지 않는다. 그건 원본을 따라간 것이지 사람이 고른 것이 아니다.
 */
export function recallFor(
  rows: Recallable[],
  hint: { vendor?: string; title?: string },
): Recall | null {
  const vendor = flatten(hint.vendor ?? '');
  const title = flatten(hint.title ?? '');
  if (!vendor && !title) return null;

  const real = rows.filter((e) => !e.isAdjustment);

  /* 판매처가 먼저다. 같은 가게에서 산 것이 같은 이름으로 적힌 것보다 강한 근거다 —
     '폼보드'는 어디서든 살 수 있지만 호미화방은 한 곳이다. */
  let by = hint.vendor?.trim() ?? '';
  let found = vendor ? real.filter((e) => flatten(e.vendor ?? '') === vendor) : [];
  let sameVendor = true;

  if (found.length < ENOUGH && title) {
    by = hint.title?.trim() ?? '';
    found = real.filter((e) => flatten(e.title) === title);
    sameVendor = false;
  }
  if (found.length < ENOUGH) return null;

  const recent = found.slice(-LOOK_BACK);

  return {
    by,
    category: top(recent, (e) => (e.category ? { key: e.category, value: e.category } : null), sameVendor),
    allocation: top(
      recent,
      (e) => {
        const k = keyOf(e.allocation);
        return k ? { key: k, value: e.allocation } : null;
      },
      sameVendor,
    ),
    payerId: top(recent, (e) => ({ key: e.payerId, value: e.payerId }), sameVendor),
    group: top(recent, (e) => (e.group ? { key: e.group, value: e.group } : null), sameVendor),
  };
}

/**
 * 이 장부에서 지금까지 쓴 분류들. 많이 쓴 순.
 *
 * 분류 칸은 자유롭게 적는 칸인데, 자유롭게 적으면 '식비'와 '식대'와 '밥값'이
 * 따로 선다. 쓰던 것을 먼저 보여 주는 것만으로 그 갈라짐이 크게 준다.
 */
export function categoriesOf(ledger: Ledger): string[] {
  const count = new Map<string, number>();
  for (const e of ledger.expenses) {
    const c = e.category?.trim();
    if (c) count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** 이 장부에서 지금까지 적은 판매처들. 많이 쓴 순. */
export function vendorsOf(ledger: Ledger): string[] {
  const count = new Map<string, number>();
  for (const e of ledger.expenses) {
    const v = e.vendor?.trim();
    if (v) count.set(v, (count.get(v) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}
