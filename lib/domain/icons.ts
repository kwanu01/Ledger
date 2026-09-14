/**
 * 지출에 붙는 그림의 이름표 (§29)
 *
 * 그림 자체는 화면마다 다르게 그려도 되지만(웹은 SVG, 앱은 react-native-svg),
 * **이름표는 한 곳에만 있어야 한다.** 앱이 'coffee' 로 저장한 것을 서버가
 * 모르면 그 지출은 그림을 잃는다.
 *
 * 그래서 이름표는 도메인에 둔다. 여기 없는 값은 어디서 와도 받지 않는다 —
 * AI 가 고른 값이든 사람이 고른 값이든 같다.
 *
 * ── 한 번 정한 이름은 바꾸지 않는다 ─────────────────────────────
 *
 * 이 값은 장부에 저장된다. 'board' 를 'panel' 로 고치는 순간 이미 저장된
 * 지출들이 전부 그림을 잃는다. 새 그림은 **더하기만** 한다.
 */

export const ICON_KEYS = [
  // 재료 · 제작
  'board', 'wood', 'cut', 'tool', 'screw', 'tape', 'paint', 'brush', 'fabric', 'clay',
  // 문서 · 출력
  'print', 'book', 'stamp', 'note', 'pen',
  // 전자
  'bulb', 'battery', 'cable', 'chip', 'screen', 'camera',
  // 이동
  'car', 'train', 'plane', 'fuel',
  // 식음
  'food', 'coffee', 'drink', 'snack',
  // 공간 · 그 밖
  'place', 'ticket', 'box', 'gift', 'cash', 'card', 'back',
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

/** 고르는 화면에 붙는 두 글자. 그림만으로는 뭔지 모를 때가 있다. */
export const ICON_NAME: Record<IconKey, string> = {
  board: '판재', wood: '목재', cut: '재단', tool: '공구', screw: '부속',
  tape: '접착', paint: '도료', brush: '붓', fabric: '원단', clay: '조형',
  print: '출력', book: '도서', stamp: '인쇄', note: '서류', pen: '문구',
  bulb: '조명', battery: '전지', cable: '배선', chip: '부품', screen: '화면',
  camera: '촬영',
  car: '택시', train: '대중교통', plane: '항공', fuel: '주유',
  food: '식사', coffee: '카페', drink: '음료', snack: '간식',
  place: '대관', ticket: '입장', box: '배송', gift: '선물',
  cash: '현금', card: '결제', back: '환불',
};

/** 고르는 화면의 묶음. 서른 개가 한 판에 늘어서면 못 고른다. */
export const ICON_GROUPS: { name: string; keys: IconKey[] }[] = [
  { name: '재료', keys: ['board', 'wood', 'fabric', 'clay', 'paint', 'tape', 'screw'] },
  { name: '제작', keys: ['cut', 'tool', 'brush', 'camera'] },
  { name: '출력', keys: ['print', 'book', 'stamp', 'note', 'pen'] },
  { name: '전자', keys: ['bulb', 'battery', 'cable', 'chip', 'screen'] },
  { name: '이동', keys: ['car', 'train', 'plane', 'fuel'] },
  { name: '식음', keys: ['food', 'coffee', 'drink', 'snack'] },
  { name: '그 밖', keys: ['place', 'ticket', 'box', 'gift', 'cash', 'card', 'back'] },
];

const SET = new Set<string>(ICON_KEYS);

/**
 * 밖에서 온 값을 받아들일지 판정한다.
 *
 * AI 가 고른 값도 사람이 고른 값도 이 문을 지난다. 모르는 이름이 오면
 * **짐작해서 가까운 것으로 바꾸지 않는다.** 확인할 수 없는 값은 빈칸보다
 * 나쁘다 — 영수증을 읽을 때와 같은 규칙이다.
 */
export function asIconKey(v: unknown): IconKey | undefined {
  return typeof v === 'string' && SET.has(v) ? (v as IconKey) : undefined;
}

/**
 * 아무도 안 골랐을 때 붙는 그림.
 *
 * 분류가 먼저고, 분류로 안 갈리는 것만 이름으로 본다. 이름 맞히기를
 * 앞에 두면 '아크릴 배송비'가 판재로 가는 것처럼 조용히 틀린다.
 */
export function defaultIcon(category?: string, title?: string, refunded?: boolean): IconKey {
  if (refunded) return 'back';

  const t = title ?? '';
  if (/카페|커피|아메리카노|라떼/.test(t)) return 'coffee';
  if (/식사|밥|점심|저녁|배달|마라탕|치킨|피자/.test(t)) return 'food';
  if (/음료|주스|생수|물/.test(t)) return 'drink';
  if (/간식|과자|빵/.test(t)) return 'snack';
  if (/택시|버스|지하철/.test(t)) return 'car';
  if (/배송|택배|운송/.test(t)) return 'box';
  if (/참가비|등록비|입장/.test(t)) return 'ticket';

  switch (category) {
    case '재료비':
      return 'board';
    case '출력비':
      return 'print';
    case '전장':
      return 'bulb';
    case '이동비':
      return 'car';
    case '도구':
      return 'tool';
    case '제작비':
      return 'cut';
    case '식비':
      return 'food';
    default:
      return 'note';
  }
}
