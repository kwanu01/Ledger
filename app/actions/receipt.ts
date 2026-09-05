'use server';

import { requireLedgerAccess, AccessError } from '../../lib/access.ts';
import { aiUsageThisMonth, recordAiUsage, MONTHLY_AI_LIMIT } from '../../lib/db/repo.ts';
import { readReceipt, type Extracted } from '../../lib/ai/receipt.ts';
import { readReceiptLines, type ExtractedItems } from '../../lib/ai/items.ts';
import { jot } from '../../lib/ai/jot.ts';
import { jotIncome } from '../../lib/ai/income.ts';
import { sayFor, type SayWhy } from '../../lib/ai/say.ts';
import { duesBoard } from '../../lib/domain/closing.ts';
import { openTransfers } from '../../lib/db/repo.ts';
import { formatMoney, type Locale } from '../../lib/domain/money.ts';
import { collectsDues, usesFund } from '../../lib/domain/closing.ts';
import { loadLedger } from '../../lib/db/repo.ts';
import type { Allocation } from '../../lib/domain/types.ts';

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

/**
 * 사진을 받아 검사하고, 상한을 확인하고, base64 로 만든다.
 * 총액 읽기와 줄 단위 읽기가 똑같이 거쳐야 하는 문 앞이다.
 */
async function admit(
  formData: FormData,
): Promise<{ ok: true; ledgerId: string; base64: string; mediaType: string } | { ok: false; message: string }> {
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
  return { ok: true, ledgerId, base64, mediaType: file.type };
}

/** 성공이든 실패든 부른 만큼은 기록한다. 상한이 뜻을 가지려면 그래야 한다. */
async function bill(
  ledgerId: string,
  r: { ok: boolean; usage?: { model: string; inputTokens: number; outputTokens: number; costMicroUsd: number } },
) {
  if (!r.usage) return;
  await recordAiUsage({
    ledgerId,
    model: r.usage.model,
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
    costMicroUsd: r.usage.costMicroUsd,
    succeeded: r.ok,
  });
}

export async function analyzeReceipt(formData: FormData): Promise<ReadResult> {
  try {
    const gate = await admit(formData);
    if (!gate.ok) return gate;

    const r = await readReceipt({ base64: gate.base64, mediaType: gate.mediaType });
    await bill(gate.ledgerId, r);

    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, value: r.value, fields: r.fields };
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, message: e.message };
    return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.' };
  }
}

export type LinesResult =
  | { ok: true; value: ExtractedItems }
  | { ok: false; message: string };

/**
 * 영수증을 줄 단위로 읽는다 (§10.4)
 *
 * 총액 읽기와 문은 같고 부르는 모델이 다르다. 줄 단위 읽기는 더 큰 모델을
 * 쓰고 더 오래 기다린다 — 이유는 lib/ai/usage.ts 에 적어 두었다.
 *
 * 값을 재는 자는 같다. 어느 쪽으로 읽든 키 주인이 내는 돈이고, 상한도 하나다.
 */
export async function analyzeReceiptLines(formData: FormData): Promise<LinesResult> {
  try {
    const gate = await admit(formData);
    if (!gate.ok) return gate;

    const r = await readReceiptLines({ base64: gate.base64, mediaType: gate.mediaType });
    await bill(gate.ledgerId, r);

    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, value: r.value };
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, message: e.message };
    return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.' };
  }
}

/* ── 한 줄로 적기 (§11.4) ─────────────────────────────────────────────── */

export type JotFilled = {
  title: string;
  amount?: number;
  currency?: string;
  date?: string;
  vendor?: string;
  category?: string;
  /** 이름이 아니라 id 다. 이름 → id 는 서버가 한다. */
  payerId?: string;
  allocation?: Allocation;
  missing: string[];
};

export type JotOut = { ok: true; value: JotFilled } | { ok: false; message: string };

/**
 * 한 줄로 적은 글을 폼 한 벌로 바꾼다.
 *
 * 모델은 팀원 **이름**만 다룬다. id 는 여기서 붙인다 — 모델이 id 를 지어낼
 * 자리를 아예 두지 않기 위해서다. 이름이 안 맞으면 그 칸은 비우고,
 * 무엇이 비었는지 화면에 알린다.
 *
 * 저장하지 않는다. 폼에 채워질 뿐이고 마지막으로 보는 것은 사람이다.
 */
export async function jotExpense(input: { ledgerId: string; text: string }): Promise<JotOut> {
  try {
    const pass = await requireLedgerAccess(input.ledgerId);
    const text = input.text.trim();
    if (!text) return { ok: false, message: '무엇을 샀는지 한 줄 적어 주세요.' };

    const used = await aiUsageThisMonth(input.ledgerId);
    if (used >= MONTHLY_AI_LIMIT) {
      return {
        ok: false,
        message: `이번 달 분석 횟수를 다 썼습니다(${MONTHLY_AI_LIMIT}건). 직접 적어 주세요.`,
      };
    }

    const ledger = await loadLedger(input.ledgerId);
    const roster = ledger.members.filter((m) => m.active !== false);
    const me = roster.find((m) => m.id === pass.memberId);

    const r = await jot({
      text,
      today: new Date().toISOString().slice(0, 10),
      names: roster.map((m) => m.name),
      me: me?.name ?? roster[0]?.name ?? '',
      currency: ledger.currency ?? 'KRW',
    });
    await bill(input.ledgerId, r);
    if (!r.ok) return { ok: false, message: r.message };

    const v = r.value;
    const idOf = (name: string) => roster.find((m) => m.name === name)?.id;
    const payerId = v.payerName ? idOf(v.payerName) : undefined;

    /*
     * 부담 방식을 세운다.
     *
     * 이름이 하나도 안 맞으면 방식 자체를 비운다. '일부만'인데 아무도 안
     * 골라진 상태로 폼에 들어가면, 사람이 그 자리를 못 보고 넘어갈 때
     * 저장이 막힌다. 차라리 기본값(전체 공동)으로 두고 다시 고르게 한다.
     */
    let allocation: Allocation | undefined;
    const picked = (v.bearerNames ?? []).map(idOf).filter((x): x is string => Boolean(x));
    if (v.bearers === 'all') allocation = { type: 'all' };
    else if (v.bearers === 'some' && picked.length > 0) {
      allocation = { type: 'partial', participantIds: picked };
    } else if (v.bearers === 'one' && picked.length > 0) {
      allocation = { type: 'personal', ownerId: picked[0] };
    }

    const missing = [...v.missing];
    if (v.payerName && !payerId) missing.push('payer');
    if (v.bearers && v.bearers !== 'all' && picked.length === 0) missing.push('bearers');

    return {
      ok: true,
      value: {
        title: v.title,
        amount: v.amount,
        currency: v.currency,
        date: v.date,
        vendor: v.vendor,
        category: v.category,
        payerId,
        allocation,
        missing: [...new Set(missing)],
      },
    };
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, message: e.message };
    return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.' };
  }
}

/* ── 들어온 돈도 한 줄로 (§12.2) ──────────────────────────────────────── */

export type IncomeFilled = {
  title: string;
  amount?: number;
  date?: string;
  kind: string;
  /** 이름이 아니라 id. 이름 → id 는 여기서 한다. */
  memberId?: string;
  missing: string[];
};

export type IncomeOut = { ok: true; value: IncomeFilled } | { ok: false; message: string };

/**
 * "현우 3월 회비 3만원" → 수입 한 줄.
 *
 * 갈래를 사람이 고르지 않는 것이 이 함수의 존재 이유다. 스무 명 회비를
 * 적으면서 드롭다운을 스무 번 여는 일은, 서비스를 바꿔도 엑셀에서 하던
 * 그 일과 같다.
 */
export async function jotIncomeLine(input: { ledgerId: string; text: string }): Promise<IncomeOut> {
  try {
    await requireLedgerAccess(input.ledgerId);
    const text = input.text.trim();
    if (!text) return { ok: false, message: '무엇으로 들어왔는지 한 줄 적어 주세요.' };

    const used = await aiUsageThisMonth(input.ledgerId);
    if (used >= MONTHLY_AI_LIMIT) {
      return { ok: false, message: `이번 달 분석 횟수를 다 썼습니다(${MONTHLY_AI_LIMIT}건). 직접 적어 주세요.` };
    }

    const ledger = await loadLedger(input.ledgerId);
    if (!usesFund(ledger)) return { ok: false, message: '이 장부에는 들어온 돈을 적지 않습니다.' };

    const roster = ledger.members.filter((m) => m.active !== false);
    const r = await jotIncome({
      text,
      today: new Date().toISOString().slice(0, 10),
      names: roster.map((m) => m.name),
      me: roster[0]?.name ?? '',
      dues: collectsDues(ledger),
    });
    await bill(input.ledgerId, r);
    if (!r.ok) return { ok: false, message: r.message };

    const v = r.value;
    return {
      ok: true,
      value: {
        title: v.title,
        amount: v.amount,
        date: v.date,
        kind: v.kind,
        memberId: v.payerName ? roster.find((m) => m.name === v.payerName)?.id : undefined,
        missing: v.missing,
      },
    };
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, message: e.message };
    return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.' };
  }
}


/* ── 말 대신 써 주기 (§15.2) ──────────────────────────────────────────── */

export type SayOut = { ok: true; text: string } | { ok: false; message: string };

/** 모델에게 넘길 언어 이름. 코드가 아니라 사람이 읽는 말이어야 한다. */
const SAY_IN: Record<string, string> = {
  ko: '한국어', en: 'English', ja: '日本語', zh: '中文', es: 'español', vi: 'tiếng Việt',
};

/**
 * 받을 돈 얘기를 꺼내는 문장을 대신 쓴다.
 *
 * ── 금액은 클라이언트에서 받지 않는다
 *
 * 화면이 보낸 금액을 그대로 문장에 넣으면, 그 문장은 **장부가 아니라 브라우저가
 * 한 말**이 된다. 여기서 장부를 다시 읽고 직접 센다. 화면이 주는 것은
 * "누구에게, 무엇 때문에"뿐이다.
 *
 * 그리고 그 계산은 도메인 함수가 한다 — duesBoard 와 확정된 정산의 snapshot.
 * 이 파일에서 새로 세는 숫자는 하나도 없다.
 */
export async function askToPay(input: {
  ledgerId: string;
  toMemberId: string;
  why: SayWhy;
  warm: boolean;
  lang: string;
}): Promise<SayOut> {
  try {
    const pass = await requireLedgerAccess(input.ledgerId);

    const used = await aiUsageThisMonth(input.ledgerId);
    if (used >= MONTHLY_AI_LIMIT) {
      return { ok: false, message: `이번 달 분석 횟수를 다 썼습니다(${MONTHLY_AI_LIMIT}건).` };
    }

    const ledger = await loadLedger(input.ledgerId);
    const to = ledger.members.find((m) => m.id === input.toMemberId);
    if (!to) return { ok: false, message: '그 사람을 찾을 수 없습니다.' };
    const me = ledger.members.find((m) => m.id === pass.memberId);

    const lang = (input.lang in SAY_IN ? input.lang : 'ko') as Locale;
    const cash = (n: number) => formatMoney(n, ledger.currency ?? 'KRW', lang);

    /* 얼마인지는 여기서 센다. 화면이 준 숫자는 쓰지 않는다. */
    let amount = 0;
    let what = '';
    if (input.why === 'dues') {
      if (!collectsDues(ledger)) return { ok: false, message: '회비를 걷지 않는 장부입니다.' };
      amount = duesBoard(ledger, ledger.members).find((r) => r.memberId === to.id)?.short ?? 0;
      what = ledger.name;
      if (amount <= 0) return { ok: false, message: '이 사람은 회비를 다 냈습니다.' };
    } else {
      /* 아직 확인되지 않은 송금 중, 이 사람이 나에게 보낼 것만 센다.
         여러 회차에 걸쳐 있으면 합친다 — 받는 쪽에서 보면 한 건이다. */
      const open = await openTransfers(input.ledgerId);
      const mine = open.filter(
        (t) => t.from_member_id === to.id && t.to_member_id === pass.memberId,
      );
      amount = mine.reduce((a, t) => a + t.amount, 0);
      const seqs = [...new Set(mine.map((t) => t.seq))];
      what = seqs.map((n) => `${n}차 정산`).join(', ') || ledger.name;
      if (amount <= 0) return { ok: false, message: '이 사람에게 받을 돈이 없습니다.' };
    }

    const r = await sayFor({
      team: ledger.teamName,
      from: me?.name ?? '',
      to: to.name,
      amount: cash(amount),
      why: input.why,
      what,
      warm: input.warm,
      lang: SAY_IN[lang] ?? '한국어',
    });
    await bill(input.ledgerId, r);
    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, text: r.value.text };
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, message: e.message };
    return { ok: false, message: '문장을 만들지 못했습니다.' };
  }
}
