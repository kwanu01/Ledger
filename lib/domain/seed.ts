/**
 * Ledger — 정산 엔진 검산용 시드 데이터 (Master Context §32-1)
 *
 * **화면에서는 쓰지 않는다.** 예전에는 이 시드로 "샘플 장부"를 만들어 주었지만
 * 지어낸 장부를 보여 주는 일은 걷어냈다. 지금 이 파일이 있는 이유는 하나다 —
 * `npm run simulate` 이 여기 있는 한 장부로 불변식 21개를 돌린다. 정산 엔진이
 * 맞는지 확인할 수 있는 자리다.
 *
 * 가상 팀 4인 / 22건 지출 / 중간 정산 1회 / 팀원 1명 중도 합류.
 * §29 Phase 2의 검증 케이스를 전부 한 장부 안에 담는다.
 *
 *   ✓ 전체 공동 부담
 *   ✓ 일부 인원 부담
 *   ✓ 개인 귀속 (결제자 = 귀속자)      → 공동 정산 영향 0
 *   ✓ 개인 귀속 (결제자 ≠ 귀속자)      → 귀속자가 결제자에게 갚아야 함
 *   ✓ 여러 명이 번갈아 결제
 *   ✓ 나누어떨어지지 않는 금액 (나머지 배분)
 *   ✓ 중간 정산 이후 지출 계속 누적
 *   ✓ 최종 정산
 *   ✓ 동일 제품 반복 구매 (AI Stage 2 감지 대상)
 *   ✓ 팀원 중도 합류 — 합류 이전 지출은 옛 명단으로 고정
 *   ✓ 환불 (음수 금액 지출)
 *   ✓ 이미 정산된 지출의 보정 (원본 불변, 차액만 다음 정산으로)
 */

import type { Expense, Ledger, Member, MemberId } from './types.ts';
import { computeSettlement } from './settlement.ts';

export const members: Member[] = [
  { id: 'kw', name: '관우' },
  { id: 'hw', name: '현우' },
  { id: 'sj', name: '성주' },
  { id: 'yr', name: '유란' }, // 10월 1일 합류
];

/**
 * 팀원 명단은 시점마다 다르다. 지출을 기록할 때 이 명단이 그대로 박힌다.
 * 9월에는 셋이었고, 10월 1일에 유란이 합류해 넷이 되었다.
 */
const ROSTER_3: MemberId[] = ['kw', 'hw', 'sj'];
const ROSTER_4: MemberId[] = ['kw', 'hw', 'sj', 'yr'];

const LEDGER_ID = 'ledger-ds02';

type Draft = Omit<Expense, 'ledgerId' | 'createdAt' | 'createdBy'>;

const drafts: Draft[] = [
  // ── Settlement #01 대상 (팀원 3인) ─────────────────────────────────
  {
    id: 'e01', date: '2026-09-01', title: '폼보드 5T 5장', amount: 32500, payerId: 'kw',
    teamMemberIds: ROSTER_3, vendor: '알파문구 정릉점', category: '재료비', allocation: { type: 'all' },
    productLink: 'https://example.com/foamboard-5t', receiptImage: 'receipt-e01.jpg',
  },
  {
    id: 'e02', date: '2026-09-02', title: '아크릴 3T 재단', amount: 60000, payerId: 'sj',
    teamMemberIds: ROSTER_3, vendor: '을지로 아크릴상가', category: '제작비', allocation: { type: 'all' },
    receiptImage: 'receipt-e02.jpg',
  },
  {
    id: 'e03', date: '2026-09-03', title: '목공본드와 양면테이프', amount: 8500, payerId: 'hw',
    teamMemberIds: ROSTER_3, vendor: '다이소', category: '재료비', allocation: { type: 'all' },
  },
  {
    id: 'e04', date: '2026-09-05', title: 'A0 출력 3장', amount: 54000, payerId: 'kw',
    teamMemberIds: ROSTER_3, vendor: '홍대 그래픽스', category: '출력비', allocation: { type: 'all' },
    receiptImage: 'receipt-e04.jpg',
  },
  {
    // 일부 인원 부담 — 현우는 자재 운반에 함께하지 않았다
    id: 'e05', date: '2026-09-06', title: '택시 (자재 운반)', amount: 24000, payerId: 'sj',
    teamMemberIds: ROSTER_3, vendor: '카카오T', category: '이동비',
    allocation: { type: 'partial', participantIds: ['kw', 'sj'] },
  },
  {
    // 개인 귀속 · 결제자 = 귀속자 → 공동 정산 영향 0
    id: 'e06', date: '2026-09-08', title: '커팅매트 A2', amount: 21000, payerId: 'hw',
    teamMemberIds: ROSTER_3, vendor: '알파문구', category: '도구',
    allocation: { type: 'personal', ownerId: 'hw' },
    note: '프로젝트 끝나고 현우가 가져감',
  },
  {
    id: 'e07', date: '2026-09-09', title: '스프레이 도료 4캔', amount: 36800, payerId: 'sj',
    teamMemberIds: ROSTER_3, vendor: '삼화페인트몰', category: '재료비', allocation: { type: 'all' },
    productLink: 'https://example.com/spray-paint',
  },
  {
    id: 'e08', date: '2026-09-11', title: '사포와 커터날 세트', amount: 12300, payerId: 'kw',
    teamMemberIds: ROSTER_3, vendor: '다이소', category: '재료비', allocation: { type: 'all' },
  },
  {
    id: 'e09', date: '2026-09-13', title: '3D 프린팅 출력 대행', amount: 88000, payerId: 'sj',
    teamMemberIds: ROSTER_3, vendor: '쓰리디몰', category: '제작비', allocation: { type: 'all' },
    receiptImage: 'receipt-e09.jpg',
  },
  {
    // 나머지 배분 케이스: 21,500 / 3 = 7,166.67 → 7,167 · 7,167 · 7,166
    id: 'e10', date: '2026-09-15', title: '팀 회의 카페', amount: 21500, payerId: 'hw',
    teamMemberIds: ROSTER_3, vendor: '스타벅스 국민대점', category: '기타',
    allocation: { type: 'all' },
  },
  {
    id: 'e11', date: '2026-09-17', title: 'MDF 재단', amount: 45000, payerId: 'kw',
    teamMemberIds: ROSTER_3, vendor: '방산시장 목재', category: '재료비', allocation: { type: 'all' },
  },
  {
    id: 'e12', date: '2026-09-18', title: '아크릴 배송비', amount: 4000, payerId: 'sj',
    teamMemberIds: ROSTER_3, category: '재료비', allocation: { type: 'all' },
    note: '아크릴 재단 건 배송비 — 부가 금액은 별도 항목 없이 그대로 기록',
  },

  // ── Settlement #01 (09-20) 이후 ────────────────────────────────────
  //
  // 여기서부터가 아직 정산하지 않은 몫이다. 이 구간에서 관우(=검산의 '나')는
  // 결제한 것이 없고 부담만 쌓인다. 그래서 홈 화면에 "보낼 돈"이 뜨고,
  // 계좌·토스 링크·보냈어요를 눌러 볼 수 있다.
  {
    id: 'e13', date: '2026-09-22', title: 'LED 스트립 5m 4롤', amount: 27900, payerId: 'hw',
    teamMemberIds: ROSTER_3, vendor: '디바이스마트', category: '전장', allocation: { type: 'all' },
    productLink: 'https://example.com/led-strip',
  },
  {
    id: 'e14', date: '2026-09-24', title: '아두이노 우노 + 케이블', amount: 34500, payerId: 'hw',
    teamMemberIds: ROSTER_3, vendor: '디바이스마트', category: '전장', allocation: { type: 'all' },
    productLink: 'https://example.com/arduino-uno',
  },
  {
    // 반복 구매 — e07과 동일 제품 (AI Stage 2 감지 대상)
    id: 'e15', date: '2026-09-27', title: '스프레이 도료 4캔 (재구매)', amount: 36800, payerId: 'sj',
    teamMemberIds: ROSTER_3, vendor: '삼화페인트몰', category: '재료비', allocation: { type: 'all' },
    productLink: 'https://example.com/spray-paint',
  },
  {
    id: 'e16', date: '2026-09-30', title: '택시 (전시장 답사)', amount: 18400, payerId: 'sj',
    teamMemberIds: ROSTER_3, vendor: '카카오T', category: '이동비',
    allocation: { type: 'partial', participantIds: ['kw', 'sj'] },
  },

  // ── 10월 1일: 유란 합류. 이후 '전체 팀'은 4인을 뜻한다 ──────────────
  {
    id: 'e17', date: '2026-10-04', title: '전시 판넬 A1 6장', amount: 96000, payerId: 'hw',
    teamMemberIds: ROSTER_4, vendor: '홍대 그래픽스', category: '출력비', allocation: { type: 'all' },
    receiptImage: 'receipt-e17.jpg',
  },
  {
    // 개인 귀속 · 결제자 ≠ 귀속자 → 관우가 성주에게 39,000을 갚아야 한다
    id: 'e18', date: '2026-10-08', title: '전동 드라이버 세트', amount: 39000, payerId: 'sj',
    teamMemberIds: ROSTER_4, vendor: '보쉬 공식몰', category: '도구',
    allocation: { type: 'personal', ownerId: 'kw' },
    note: '성주가 대신 결제, 관우 개인 소유',
    productLink: 'https://example.com/bosch-driver',
  },
  {
    id: 'e19', date: '2026-10-12', title: '케이블타이와 피스', amount: 9750, payerId: 'yr',
    teamMemberIds: ROSTER_4, vendor: '철물점', category: '재료비', allocation: { type: 'all' },
  },
  {
    id: 'e20', date: '2026-10-15', title: '설치 당일 식사 4인', amount: 52000, payerId: 'sj',
    teamMemberIds: ROSTER_4, vendor: '정릉 백반', category: '기타', allocation: { type: 'all' },
  },

  // ── 환불 / 보정 ───────────────────────────────────────────────────
  {
    /**
     * 환불: 음수 금액 지출로 기록하고 원 지출에 연결한다.
     * 부담 구조(명단·부담 방식)는 반드시 원본을 그대로 따른다.
     * 그러지 않으면 3인이 나눠 낸 돈이 4인에게 환급되어 잔액이 남는다.
     */
    id: 'e21', date: '2026-10-18', title: 'LED 스트립 1롤 반품', amount: -8900, payerId: 'hw',
    teamMemberIds: ROSTER_3, vendor: '디바이스마트', category: '전장', allocation: { type: 'all' },
    adjustment: { kind: 'refund', targetExpenseId: 'e13', reason: '1롤 불량 반품' },
  },
  {
    /**
     * 보정: e10은 이미 Settlement #01에 확정되어 있다.
     * 원본을 고치지 않고 차액만 새 지출로 남겨 다음 정산에 태운다.
     * 21,500 → 실제 23,500. 차액 +2,000을 원본과 같은 3인이 나눈다.
     */
    id: 'e22', date: '2026-10-19', title: '팀 회의 카페 금액 보정', amount: 2000, payerId: 'hw',
    teamMemberIds: ROSTER_3, vendor: '스타벅스 국민대점', category: '기타',
    allocation: { type: 'all' },
    adjustment: { kind: 'correction', targetExpenseId: 'e10', reason: '영수증 재확인 — 21,500이 아니라 23,500' },
  },
];

export const expenses: Expense[] = drafts.map((d) => ({
  ...d,
  ledgerId: LEDGER_ID,
  createdAt: `${d.date}T12:00:00+09:00`,
  createdBy: d.payerId,
}));

const FIRST_CYCLE = ['e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e07', 'e08', 'e09', 'e10', 'e11', 'e12'];

/**
 * 중간 정산 1회가 확정된 상태의 장부를 만든다.
 * 확정 시점의 계산 결과를 snapshot으로 통째로 저장한다 (§28.4).
 */
export function buildLedger(): Ledger {
  const firstCycle = expenses.filter((e) => FIRST_CYCLE.includes(e.id));
  return {
    id: LEDGER_ID,
    teamName: 'DESIGN STUDIO 02',
    name: '2026-2학기 디자인 스튜디오',
    currency: 'KRW',
    startedAt: '2026-09-01',
    members,
    expenses,
    settlements: [
      {
        id: 'st01',
        ledgerId: LEDGER_ID,
        seq: 1,
        date: '2026-09-20',
        label: '1차 중간 정산',
        isFinal: false,
        snapshot: computeSettlement(firstCycle, members),
      },
    ],
  };
}

export { currentRoster } from './settlement.ts';

/* ------------------------------------------------------------------ */
/* 두 번째 팀 — 수업이 둘이면 팀도 둘이다                              */
/* ------------------------------------------------------------------ */

const TF_ID = 'ledger-comp';
const TF: Member[] = [
  { id: 'kw2', name: '관우' },
  { id: 'sy', name: '서연' },
  { id: 'dy', name: '도윤' },
];
const TF_ROSTER: MemberId[] = ['kw2', 'sy', 'dy'];

const tfDrafts: Draft[] = [
  {
    id: 'c01', date: '2026-10-02', title: '공모전 참가비', amount: 30000, payerId: 'sy',
    teamMemberIds: TF_ROSTER, vendor: '공공디자인진흥원', category: '기타', allocation: { type: 'all' },
  },
  {
    id: 'c02', date: '2026-10-06', title: '패널 출력 A1 3장', amount: 42000, payerId: 'kw2',
    teamMemberIds: TF_ROSTER, vendor: '홍대 그래픽스', category: '출력비', allocation: { type: 'all' },
    receiptImage: 'receipt-c02.jpg',
  },
  {
    id: 'c03', date: '2026-10-09', title: '자료조사 교통비', amount: 11400, payerId: 'dy',
    teamMemberIds: TF_ROSTER, vendor: '카카오T', category: '이동비',
    allocation: { type: 'partial', participantIds: ['sy', 'dy'] },
  },
  {
    id: 'c04', date: '2026-10-14', title: '목업 소재 구입', amount: 27800, payerId: 'sy',
    teamMemberIds: TF_ROSTER, vendor: '방산시장', category: '재료비', allocation: { type: 'all' },
    productLink: 'https://example.com/mockup-material',
  },
  {
    id: 'c05', date: '2026-10-17', title: '제본 5부', amount: 25000, payerId: 'kw2',
    teamMemberIds: TF_ROSTER, vendor: '학교 앞 복사집', category: '출력비', allocation: { type: 'all' },
  },
];

export const tfExpenses: Expense[] = tfDrafts.map((d) => ({
  ...d,
  ledgerId: TF_ID,
  createdAt: `${d.date}T12:00:00+09:00`,
  createdBy: d.payerId,
}));

export function buildCompetitionLedger(): Ledger {
  return {
    id: TF_ID,
    teamName: 'COMPETITION TF',
    name: '2026 공공디자인 공모전',
    currency: 'KRW',
    startedAt: '2026-10-02',
    members: TF,
    expenses: tfExpenses,
    settlements: [],
  };
}

/** 로그인한 사람이 가진 장부 전부 */
export function buildLedgers(): Ledger[] {
  return [buildLedger(), buildCompetitionLedger()];
}
