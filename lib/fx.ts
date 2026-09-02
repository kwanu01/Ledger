import 'server-only';

/**
 * 환율 (§21.14)
 *
 * ── 환율은 검산에 쓰지, 장부에 적지 않는다 ──────────────────────────
 *
 * 해외 결제를 적을 때 우리가 환산해서 장부에 넣고 싶은 유혹이 있다. 그러면
 * 안 된다. **카드사가 이미 환산해서 청구했기 때문이다.** 그쪽 환율은 우리가
 * 보는 환율과 다르다 — 매매기준율이 아니라 각사 전신환매도율이고, 여기에
 * 해외 이용 수수료가 1~2% 붙고, 승인일과 매입일이 며칠 어긋난다. 우리가
 * 계산한 숫자를 장부에 넣으면, 실제로 통장에서 빠져나간 금액과 다른 숫자가
 * 팀원들 사이에 나뉜다. 장부가 틀리는 것이다.
 *
 * 그래서 장부에 적히는 것은 언제나 **실제로 청구된 금액**이다. 환율은 그
 * 숫자가 그럴듯한지 옆에서 재 보는 자에 지나지 않는다.
 *
 *   · 청구액을 아직 모르면 → 환산값을 **미리 채워 준다.** 고칠 수 있다.
 *   · 청구액을 적었으면    → 환율로 잰 값과 얼마나 벌어지는지 **알려만 준다.**
 *                            막지 않는다. 수수료 때문에 벌어지는 게 정상이다.
 *
 * ── 어디서 가져오나 ────────────────────────────────────────────────
 *
 * Frankfurter(ECB 고시). 키가 필요 없고, **날짜를 지정할 수 있다.**
 * 날짜가 중요하다 — 지난달에 산 것을 오늘 적을 수도 있고, 그때는 오늘 환율이
 * 아니라 그날 환율로 재야 한다. 주말·공휴일은 ECB 고시가 없어서 직전
 * 영업일 값이 돌아오고, 응답에 그 날짜가 함께 온다. 화면에는 그 날짜를 적는다.
 *
 * 못 가져오면 조용히 없는 것으로 둔다. 환율은 있으면 좋은 것이지, 없으면
 * 지출을 못 적는 것이 아니다.
 */

const SOURCE = 'https://api.frankfurter.dev/v1';
/** 한 번 물어보고 이만큼 지나기 전에는 다시 안 묻는다. 고시는 하루 한 번이다. */
const KEEP_MS = 6 * 60 * 60 * 1000;
/** 밖에 나갔다 오는 일이라 오래 기다리지 않는다. 없으면 없는 대로 간다. */
const TIMEOUT_MS = 4000;

export type Rate = {
  from: string;
  to: string;
  /** 1 from = rate to */
  rate: number;
  /** 실제로 이 환율이 고시된 날. 주말이면 직전 영업일이 온다. */
  on: string;
};

const cache = new Map<string, { at: number; value: Rate | null }>();

/** 오늘보다 뒤인 날짜는 고시가 없다. 오늘로 당겨서 묻는다. */
function notFuture(date: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return date > today ? today : date;
}

export async function fxRate(from: string, to: string, date: string): Promise<Rate | null> {
  if (from === to) return { from, to, rate: 1, on: date };

  const on = notFuture(date);
  const key = `${from}:${to}:${on}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;

  let value: Rate | null = null;
  try {
    const url = `${SOURCE}/${encodeURIComponent(on)}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) {
      const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
      const r = body.rates?.[to];
      if (typeof r === 'number' && r > 0) {
        value = { from, to, rate: r, on: body.date ?? on };
      }
    }
  } catch {
    // 못 닿았으면 없는 것으로 둔다. 환율이 없다고 지출을 못 적지는 않는다.
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * 잰 값과 적은 값이 얼마나 벌어지는가.
 *
 * 벌어지는 것 자체는 정상이다 — 카드 수수료와 매입일 차이가 있다. 다만
 * **자릿수를 잘못 적은 것**은 벌어지는 폭이 다르다. 10배로 적으면 900%다.
 * 그래서 폭을 그대로 돌려주고, 판단은 화면이 한다.
 */
export function gapPercent(expected: number, actual: number): number | null {
  if (!expected || !actual) return null;
  return ((actual - expected) / expected) * 100;
}
