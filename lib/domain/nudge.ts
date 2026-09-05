/**
 * Ledger — 말 걸 때 (§15)
 *
 * 장부가 먼저 말을 거는 자리는 여기 하나다. 그래서 규칙이 까다롭다.
 *
 * ── 언제 말하는가
 *
 * **미룬 것이 쌓였을 때만.** 정산은 미룰수록 어려워진다 — 3주 전에 뭘 먹었는지
 * 아무도 기억하지 못하고, 금액이 커질수록 말 꺼내기가 무거워진다. 그 곡선이
 * 이 파일의 존재 이유다.
 *
 * ── 왜 조건을 두 개씩 거는가
 *
 * 하나로 걸면 반드시 헛말이 나온다. "미정산 3건"만 보면 오늘 세 줄 적은
 * 사람에게 바로 말을 걸고, "3주 경과"만 보면 한 줄짜리 장부에도 말을 건다.
 * 둘 다여야 **미룬 것**이다.
 *
 * ── 금액으로 문턱을 삼지 않는다
 *
 * "1인당 5만원이 넘으면"은 원화 장부에서만 말이 된다. 같은 코드가 엔·달러
 * 장부에서도 돌아야 하는데, 통화마다 문턱을 적어 두면 통화가 늘 때마다
 * 잊어버릴 자리가 하나씩 는다. 그래서 **문턱은 시간과 건수로만 잡고, 금액은
 * 문장에 사실로 싣는다.** "3주째 · 7건 · 1인당 52,000원"에서 판단은 사람이 한다.
 *
 * ── 끄는 단추가 없다
 *
 * 검사(§13)와 다른 점이다. 검사의 물음은 한 줄에 대한 것이라 "이 줄은
 * 괜찮다"가 성립하지만, 이쪽은 **하면 사라지는 것**이다. 정산하면 없어지고
 * 회비를 걷으면 없어진다. 끄는 단추를 두면 할 일을 지우는 단추가 된다.
 *
 * 순수 함수다. 시뮬레이션에서 그대로 검증된다.
 */

import { unsettledExpenses, breakdownOf, needsSettling } from './settlement.ts';
import { collectsDues, unpaid } from './closing.ts';
import type { Ledger, Member } from './types.ts';

/** 이만큼 지나야 '미뤘다'고 한다. 두 주는 아직 이번 주의 연장이다. */
const LATE_WEEKS = 3;
/** 그리고 이만큼은 쌓여 있어야 한다. 한두 줄은 정산할 것이 아니라 그냥 줄이다. */
const LATE_ROWS = 3;
/** 회비는 회기가 이만큼 지나야 말한다. 첫 달에 독촉하는 장부는 쓰기 싫다. */
const DUES_WEEKS = 4;

export type Nudge =
  | { kind: 'settle'; weeks: number; rows: number; total: number; perHead: number }
  | { kind: 'dues'; weeks: number; people: number; short: number };

/**
 * 마지막 정산 이후 지난 주 수. 정산한 적이 없으면 장부를 연 날부터 센다.
 *
 * 정산의 날짜는 확정한 날이지 지출의 날이 아니다. "지난번 이후 얼마나
 * 됐나"를 묻는 것이므로 확정한 날이 맞다.
 */
export function weeksSinceSettle(ledger: Ledger, today: string): number {
  const last = ledger.settlements.map((s) => s.date).sort().at(-1) ?? ledger.startedAt;
  const t = (s: string) => Date.parse(`${s}T00:00:00Z`);
  return Math.max(0, Math.floor((t(today) - t(last)) / (7 * 86400000)));
}

/**
 * 지금 장부가 할 말 (§15)
 *
 * 말이 없으면 빈 배열이다. 빈 배열이 이 함수의 정상 상태고, 화면은 그때
 * 아무것도 그리지 않는다 — 할 말이 없을 때 조용한 것이 이 파일의 절반이다.
 */
export function nudges(ledger: Ledger, members: Member[], today: string): Nudge[] {
  const out: Nudge[] = [];
  const roster = members.filter((m) => m.active !== false);

  /* 정산 — 미룬 것이 쌓였는가 */
  const open = unsettledExpenses(ledger).filter(needsSettling);
  const weeks = weeksSinceSettle(ledger, today);
  if (open.length >= LATE_ROWS && weeks >= LATE_WEEKS) {
    /*
     * 1인당은 **부담의 합을 사람 수로 나눈 것**이다.
     *
     * 정산 엔진의 불변식에 따라 부담의 합은 언제나 총액과 같으므로
     * (지분의 합 = 금액), 이 숫자는 총액을 나눈 것과 같은 값이 된다.
     * 그런데도 지분에서 세는 이유는 **어느 쪽이 옳은지를 코드가 말해야**
     * 하기 때문이다. 언젠가 지분의 합이 총액과 갈리는 줄이 생기면
     * (공금 지출이 그랬다 — 지분이 아예 없다) 총액에서 센 숫자는 조용히
     * 틀리고, 지분에서 센 숫자는 그대로 맞는다.
     *
     * 그리고 이건 평균이다. 실제로 얼마를 보낼지는 사람마다 다르다 —
     * 그래서 문장에서도 '1인당'이라고만 하고 누구에게 얼마라고는 안 한다.
     * 그 답은 정산 화면에 있다.
     */
    const total = open.reduce((a, e) => a + e.amount, 0);
    const owed = open
      .flatMap((e) => breakdownOf(e).shares)
      .reduce((a, s) => a + s.amount, 0);
    out.push({
      kind: 'settle',
      weeks,
      rows: open.length,
      total,
      perHead: roster.length > 0 ? Math.round(owed / roster.length) : 0,
    });
  }

  /* 회비 — 안 낸 사람이 남았는가 */
  if (collectsDues(ledger)) {
    const owing = unpaid(ledger, members);
    const since = weeksSinceStart(ledger, today);
    if (owing.length > 0 && since >= DUES_WEEKS) {
      out.push({
        kind: 'dues',
        weeks: since,
        people: owing.length,
        short: owing.reduce((a, r) => a + r.short, 0),
      });
    }
  }

  return out;
}

function weeksSinceStart(ledger: Ledger, today: string): number {
  const t = (s: string) => Date.parse(`${s}T00:00:00Z`);
  return Math.max(0, Math.floor((t(today) - t(ledger.startedAt)) / (7 * 86400000)));
}
