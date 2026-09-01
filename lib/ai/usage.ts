import 'server-only';

/**
 * 부른 만큼 세기 (§7, §21.10)
 *
 * 영수증 읽기와 장부 질문은 둘 다 같은 모델을 부르고, 그 비용은 키 주인이 낸다.
 * 그래서 두 곳 모두 같은 자로 재야 한다. 재는 자가 두 벌이면 한쪽만 고쳐지고
 * 상한이 조용히 어긋난다.
 *
 * 돈은 정수로만 센다. 100만분의 1달러 단위다.
 */

/**
 * 기본값은 Haiku다.
 *
 * 처음에는 Sonnet이었다. 한국어 상품명을 정확히 옮겨 적는다는 이유였는데,
 * 실제로 폰에서 써 보니 **기다리는 시간**이 먼저 문제가 됐다. 영수증을 찍어
 * 올리는 자리는 몇 초를 기다릴 수 있는 자리가 아니다. 오래 걸리면 사람은
 * 기다리지 않고 직접 적는다. 그러면 이 기능은 있으나 마나 해진다.
 *
 * 이름이 조금 틀리는 것은 그 자리에서 고칠 수 있다 — 읽어 온 값은 폼에
 * 채워질 뿐이고, 마지막으로 보는 것은 언제나 사람이다. 반면 대답이 아예
 * 안 오는 것은 고칠 방법이 없다.
 *
 * 되돌리려면 LEDGER_AI_MODEL=claude-sonnet-4-5.
 */
export const MODEL = process.env.LEDGER_AI_MODEL || 'claude-haiku-4-5';
export const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** 1M 토큰당 USD를 100만분의 1달러 정수로 적은 것. */
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-4-5': [3_000_000, 15_000_000],
  'claude-haiku-4-5': [1_000_000, 5_000_000],
};
const [IN_PER_MTOK, OUT_PER_MTOK] = PRICES[MODEL] ?? PRICES['claude-haiku-4-5'];

export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
};

/** 응답에 실려 온 토큰 수를 사용량 한 줄로 만든다. */
export function meter(raw: { input_tokens?: number; output_tokens?: number } | undefined): Usage {
  const inputTokens = raw?.input_tokens ?? 0;
  const outputTokens = raw?.output_tokens ?? 0;
  return {
    model: MODEL,
    inputTokens,
    outputTokens,
    costMicroUsd: Math.round(
      (inputTokens * IN_PER_MTOK) / 1_000_000 + (outputTokens * OUT_PER_MTOK) / 1_000_000,
    ),
  };
}
