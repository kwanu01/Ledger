'use server';

import { requireLedgerAccess, AccessError } from '../../lib/access.ts';
import { aiUsageThisMonth, recordAiUsage, MONTHLY_AI_LIMIT } from '../../lib/db/repo.ts';
import { readReceipt, type Extracted } from '../../lib/ai/receipt.ts';

/**
 * 영수증 분석 (§7)
 *
 * 읽은 값은 저장하지 않는다. 폼에 채워 넣고, 맞는지 확인하는 것은 사람이 한다.
 * 장부당 월 상한을 두는 이유는, 키 주인이 비용을 내기 때문이다.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export type ReadResult =
  | { ok: true; value: Extracted; fields: string[] }
  | { ok: false; message: string };

export async function analyzeReceipt(formData: FormData): Promise<ReadResult> {
  try {
    const ledgerId = String(formData.get('ledgerId') ?? '');
    await requireLedgerAccess(ledgerId);

    const file = formData.get('image');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: '사진을 골라 주세요.' };
    }
    if (file.size > MAX_BYTES) {
      return { ok: false, message: '사진이 너무 큽니다. 5MB 아래로 줄여 주세요.' };
    }
    if (!ALLOWED.includes(file.type)) {
      return { ok: false, message: '사진 파일만 올릴 수 있습니다.' };
    }

    const used = await aiUsageThisMonth(ledgerId);
    if (used >= MONTHLY_AI_LIMIT) {
      return {
        ok: false,
        message: `이번 달 분석 횟수를 다 썼습니다(${MONTHLY_AI_LIMIT}건). 직접 적어 주세요.`,
      };
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    const r = await readReceipt({ base64, mediaType: file.type });

    // 성공이든 실패든 부른 만큼은 기록한다. 상한이 뜻을 가지려면 그래야 한다.
    if (r.usage) {
      await recordAiUsage({
        ledgerId,
        model: r.usage.model,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        costMicroUsd: r.usage.costMicroUsd,
        succeeded: r.ok,
      });
    }

    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, value: r.value, fields: r.fields };
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, message: e.message };
    return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.' };
  }
}
