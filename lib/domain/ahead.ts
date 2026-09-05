/**
 * Ledger — 앞을 보기 (§14)
 *
 * 지금까지 이 서비스가 다룬 것은 전부 **이미 일어난 일**이다. 얼마 썼고,
 * 누가 누구에게 얼마를 보내야 하고, 얼마 남았는가. 그런데 회계 담당자가
 * 밤새우는 자리는 반대쪽이다 — **이 속도면 언제 바닥나는가.**
 *
 * ── 예산을 묻지 않는다
 *
 * 예산 칸을 하나 만들고 적으라고 하면, 장부를 쓰기 전에 설정이 하나 더
 * 늘어난다. 그런데 공금 장부에서 예산은 **이미 장부 안에 있다** — 회비와
 * 지원금으로 들어온 돈이 곧 쓸 수 있는 돈이다. 세는 일이지 묻는 일이 아니다.
 * (closing.ts 의 guessDuesPerHead 와 같은 규칙)
 *
 * 적어 두는 길은 열어 둔다. "지원금 200만원을 받기로 했는데 아직 안
 * 들어왔다"는 경우가 있고, 그때는 들어온 돈이 예산이 아니다. 사람이 적으면
 * 그 값이 이긴다.
 *
 * ── 짐작을 숫자로 내놓지 않는다
 *
 * "이 속도면 5월 3일에 바닥납니다"는 두 주치 기록으로도 계산은 된다.
 * 계산이 된다는 것과 말해도 된다는 것은 다르다. 두 주치로 낸 날짜는
 * **틀릴 뿐 아니라 틀린 줄도 모르게 만든다** — 숫자로 적히면 근거가 있어
 * 보이기 때문이다. 그래서 넉 주가 지나고 공금 지출이 세 건은 쌓여야 말한다.
 * 그 전에는 아무 말도 안 한다. 모른다고 말하는 것보다 조용한 편이 낫다.
 *
 * 그리고 말할 때도 **"이 속도면"을 문장에 박아 둔다.** 예언이 아니라
 * 나눗셈이라는 것이 문장 안에 있어야 한다.
 *
 * 여기도 순수 함수만 있다. 시뮬레이션에서 그대로 검증된다.
 */

import { fundBook } from './closing.ts';
import type { Ledger } from './types.ts';

/** 이 속도를 말하려면 이만큼은 지나 있어야 한다. */
const ENOUGH_WEEKS = 4;
/** 그리고 이만큼은 쓰였어야 한다. 한두 건으로 낸 평균은 평균이 아니다. */
const ENOUGH_ROWS = 3;

export type Burn = {
  /** 쓸 수 있는 돈. 사람이 적었거나, 들어온 돈으로 장부가 알아낸 값 */
  budget: number;
  /** 사람이 적어 둔 값인가. 화면은 알아낸 값일 때 그렇다고 적는다. */
  told: boolean;
  /** 공금에서 나간 돈 */
  spent: number;
  /** 예산 − 쓴 돈. 음수면 넘겼다. */
  left: number;
  /** 집행률(0~). 예산이 0이면 0. 1을 넘을 수 있다 — 넘긴 것도 사실이다. */
  ran: number;
  /** 회기가 시작하고 지난 주 수 */
  weeks: number;
  /**
   * 이 속도면 남은 돈이 버티는 주 수. 말할 근거가 모자라면 null.
   * null 은 "안 바닥난다"가 아니라 **"아직 모른다"**는 뜻이다.
   */
  weeksLeft: number | null;
  /** 그 주 수를 날짜로 옮긴 것 (YYYY-MM-DD). weeksLeft 가 null 이면 null */
  dryOn: string | null;
};

/**
 * 예산 — 적어 둔 것이 먼저, 없으면 들어온 돈.
 *
 * 이월금까지 센다. 지난 회기에서 넘어온 돈도 이번 회기에 쓸 수 있는 돈이다.
 */
export function budgetOf(ledger: Ledger): { amount: number; told: boolean } {
  if (ledger.budget && ledger.budget > 0) return { amount: ledger.budget, told: true };
  const book = fundBook(ledger);
  return { amount: book.carriedIn + book.received, told: false };
}

/**
 * 얼마나 썼고, 이 속도면 얼마나 가는가 (§14)
 *
 * 주 단위로 재는 이유는 학교의 시간이 주 단위이기 때문이다. 한 학기는
 * 열대여섯 주고, "3주 남았습니다"는 동아리 담당자에게 바로 뜻이 서는 말이다.
 * 일 단위는 너무 잘게 흔들리고 달 단위는 학기 안에서 서너 칸밖에 없다.
 *
 * 넘긴 경우(left < 0)에는 버틸 주 수를 세지 않는다. 이미 지난 일이라
 * 앞을 볼 것이 없다 — 화면은 넘긴 금액을 그대로 말하면 된다.
 */
export function burn(ledger: Ledger, today: string): Burn {
  const { amount: budget, told } = budgetOf(ledger);
  const book = fundBook(ledger);
  const spent = book.spent;
  const left = budget - spent;
  const ran = budget > 0 ? spent / budget : 0;

  const weeks = weeksBetween(ledger.startedAt, today);
  const rows = ledger.expenses.filter((e) => e.allocation.type === 'common' && !e.adjustment).length;

  const canSay = weeks >= ENOUGH_WEEKS && rows >= ENOUGH_ROWS && spent > 0 && left > 0;
  const perWeek = canSay ? spent / weeks : 0;
  const weeksLeft = canSay && perWeek > 0 ? Math.floor(left / perWeek) : null;

  return {
    budget,
    told,
    spent,
    left,
    ran,
    weeks,
    weeksLeft,
    dryOn: weeksLeft === null ? null : addWeeks(today, weeksLeft),
  };
}

/** 지난 주 수. 최소 1 — 0으로 나누지 않기 위해서이자, 첫 주도 한 주이기 때문이다. */
export function weeksBetween(from: string, to: string): number {
  const t = (s: string) => Date.parse(`${s}T00:00:00Z`);
  const days = Math.floor((t(to) - t(from)) / 86400000);
  return Math.max(1, Math.floor(days / 7));
}

function addWeeks(from: string, n: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}
