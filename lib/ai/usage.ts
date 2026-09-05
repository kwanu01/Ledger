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

/**
 * 한 군데만 다르다 — 영수증을 **줄 단위로** 읽을 때 (§10.4)
 *
 * 위의 판단(빠른 쪽이 낫다)은 총액 하나를 읽을 때의 이야기다. 총액은 큰 글씨로
 * 한 번 찍히고, 틀리면 눈에 바로 띈다. 줄 단위 읽기는 반대다 — 열두 줄을 읽어
 * 열두 사람에게 나눠 청구하는데, 그중 한 줄의 금액이 틀리면 아무도 모른다.
 * 틀린 채로 정산이 끝나고, 몇 천 원이 조용히 다른 사람 몫이 된다.
 *
 * 그리고 이 자리는 기다릴 수 있는 자리다. 사람이 이미 "항목별로 나누겠다"고
 * 마음먹고 들어온 자리고, 그다음에 줄마다 팀원을 고르는 일이 남아 있다.
 * 몇 초 더 걸리는 것이 한 줄 틀리는 것보다 낫다.
 *
 * 되돌리려면 LEDGER_AI_ITEM_MODEL 로 바꾼다.
 */
export const ITEM_MODEL = process.env.LEDGER_AI_ITEM_MODEL || 'claude-sonnet-4-5';

export const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** 1M 토큰당 USD를 100만분의 1달러 정수로 적은 것. */
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-4-5': [3_000_000, 15_000_000],
  'claude-haiku-4-5': [1_000_000, 5_000_000],
};

export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
};

/**
 * 응답에 실려 온 토큰 수를 사용량 한 줄로 만든다.
 *
 * 어느 모델을 불렀는지 함께 받는다. 값이 모델마다 다르므로, 부른 모델과
 * 값을 매기는 모델이 어긋나면 상한이 조용히 틀어진다.
 */
export function meter(
  raw: { input_tokens?: number; output_tokens?: number } | undefined,
  model: string = MODEL,
): Usage {
  const inputTokens = raw?.input_tokens ?? 0;
  const outputTokens = raw?.output_tokens ?? 0;
  const [inPerMTok, outPerMTok] = PRICES[model] ?? PRICES['claude-sonnet-4-5'];
  return {
    model,
    inputTokens,
    outputTokens,
    costMicroUsd: Math.round(
      (inputTokens * inPerMTok) / 1_000_000 + (outputTokens * outPerMTok) / 1_000_000,
    ),
  };
}
