/**
 * Ledger — 검사 (§13)
 *
 * 적기만 하면 기록이고, **검사하면 회계다.** 이 파일이 그 선이다.
 *
 * ── 무엇을 하는 파일인가
 *
 * 이미 적힌 장부를 훑어서 "이거 맞나요?" 하고 물을 자리를 찾는다.
 * 고치지 않고, 지우지 않고, 저장을 막지 않는다. 가리키기만 한다.
 *
 * ── 왜 순수 함수인가 (AI 를 안 부른다)
 *
 * 세는 일이기 때문이다. 같은 금액이 같은 날 두 번 적혔는지는 비교 연산이고,
 * 이 장부에서 유난히 큰 금액인지는 정렬이다. 모델을 부르면 값이 들고,
 * 느려지고, **같은 장부에 같은 답이 나온다는 보장이 사라진다.** 검사가
 * 검사이려면 언제 돌려도 같은 답이 나와야 한다. 그래서 여기엔 fetch 가 없고,
 * 전부 시뮬레이션에서 불변식으로 검증된다.
 *
 * ── 왜 전부 "틀렸다"가 아니라 "맞나요?"인가
 *
 * 이 파일이 아는 것은 숫자의 모양뿐이다. 같은 날 같은 금액이 두 번 있는 것은
 * 중복일 수도 있고, 같은 가게에서 두 번 산 것일 수도 있다. 40만원짜리 한 줄은
 * 실수일 수도 있고 진짜 40만원짜리 물건일 수도 있다. **아는 사람은 화면 앞에
 * 있는 사람이지 이 파일이 아니다.** 그래서 전부 물음이고, 사람이 "괜찮다"고
 * 하면 그 줄은 다시 묻지 않는다(checkedAt).
 *
 * ── 다시 묻지 않는다는 것이 왜 중요한가
 *
 * 끄지 못하는 경고는 두 번째부터 배경이 된다. 한 번 무시하기 시작하면 진짜
 * 하나가 섞여 들어와도 같이 무시된다. 그래서 이 파일의 모든 물음은 사람이
 * 한 번 답하면 사라지고, **사라진 물음은 사실이 달라져야만 되돌아온다.**
 */

import type { Expense, ExpenseId, Ledger, Member, MemberId } from './types.ts';

/**
 * 물음 하나.
 *
 * 말은 담지 않는다 — 여섯 개 언어로 옮겨야 하고, 그건 화면이 할 일이다.
 * 여기서 나가는 것은 무엇을 왜 가리키는지의 뼈대뿐이다.
 */
export type Flag = {
  /** 어떤 물음인가. 화면은 이 값으로 문장을 고른다. */
  kind: 'twin' | 'spike' | 'offReceipt' | 'leftOut';
  /** 가리키는 줄. leftOut 은 줄이 아니라 사람이라 비어 있다. */
  expenseId?: ExpenseId;
  /** twin 일 때 짝이 되는 먼저 적힌 줄 */
  otherId?: ExpenseId;
  /** leftOut 일 때 그 사람 */
  memberId?: MemberId;
  /** 화면이 문장에 채워 넣을 숫자들 */
  facts: Record<string, number>;
};

/* ── 중복 ─────────────────────────────────────────────────────────────── */

/**
 * 같은 지출이 두 번 적힌 것으로 보이는 짝 (§13.1)
 *
 * 제일 흔한 사고다. 밥값을 낸 사람이 적고, 사진을 찍어 둔 다른 사람이
 * 나중에 또 적는다. 둘 다 정산에 들어가면 한 끼가 두 번 나뉜다.
 *
 * ── 무엇을 같다고 보는가
 *
 * **금액이 같고, 날짜가 하루 안이고, 결제자가 같다.** 셋이 다 맞아야 한다.
 *
 * 금액을 정확히 같은 것만 보는 이유는, 여기서 느슨해지면 "커피 4,500과
 * 커피 4,700"까지 잡혀서 물음이 배경이 되기 때문이다. 잡는 것을 늘리는 것보다
 * **잡은 것이 대개 맞는 편**이 낫다.
 *
 * 하루의 여유를 두는 이유는 결제 시각과 적은 날짜가 자정을 넘어 갈리는 일이
 * 흔해서다. 술자리는 특히 그렇다.
 *
 * 결제자까지 같아야 하는 이유는, 두 사람이 각자 자기 몫을 따로 결제한 경우가
 * 정말 많기 때문이다 — 그건 중복이 아니라 두 건이다.
 *
 * ── 보정·환불 줄은 세지 않는다
 *
 * 보정은 원본과 짝이 되라고 만든 줄이라, 원본과 닮은 것이 정상이다.
 */
export function twins(expenses: Expense[]): Flag[] {
  const rows = expenses
    .filter((e) => !e.adjustment)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  const found: Flag[] = [];
  const taken = new Set<ExpenseId>();

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      // 한 줄이 여러 짝에 서면 물음이 부풀어 오른다. 나중 줄 하나에 한 번만.
      if (taken.has(b.id)) continue;
      if (a.amount !== b.amount) continue;
      if (a.payerId !== b.payerId) continue;
      if (Math.abs(daysBetween(a.date, b.date)) > 1) continue;

      taken.add(b.id);
      found.push({
        kind: 'twin',
        expenseId: b.id,
        otherId: a.id,
        facts: { amount: b.amount },
      });
      break;
    }
  }
  return found;
}

/** 두 날짜 사이의 날 수. 시간대를 타지 않게 UTC 자정으로 잰다. */
function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.parse(`${s}T00:00:00Z`);
  return Math.round((t(b) - t(a)) / 86400000);
}

/* ── 튀는 금액 ────────────────────────────────────────────────────────── */

/** 이 장부에서 큰 축에 드는 금액의 기준. 중앙값의 몇 배부터 물을 것인가. */
const SPIKE_TIMES = 6;
/** 중앙값을 말하려면 이만큼은 쌓여 있어야 한다. 셋으로는 '보통'이 없다. */
const ENOUGH_ROWS = 5;

/**
 * 이 장부에서 유난히 큰 줄 (§13.4)
 *
 * 0 을 하나 더 친 것이 제일 흔하다. 27,000 이 270,000 이 되면 정산이 통째로
 * 틀어지는데, 표에서는 그냥 한 줄이라 눈에 안 띈다.
 *
 * ── 왜 평균이 아니라 중앙값인가
 *
 * 튀는 값을 찾으려고 재는 기준에 그 튀는 값이 들어가면, 기준 자체가 끌려
 * 올라가서 정작 그 줄을 못 잡는다. 40만원짜리 하나가 평균을 두 배로 만들면
 * 40만원은 '평균의 2배'가 되어 조용히 통과한다. 중앙값은 그 하나에 안 흔들린다.
 * (회비 기준을 최빈값으로 잡은 것과 같은 이유다 — closing.ts)
 *
 * ── 왜 다섯 줄부터인가
 *
 * 세 줄짜리 장부에서 '보통'은 뜻이 없다. 첫 지출이 제일 큰 것은 흔한 일이고,
 * 거기다 대고 물으면 서비스를 처음 쓰는 사람이 처음 보는 것이 경고가 된다.
 *
 * 절댓값으로 잰다 — 환불 줄은 음수라서, 크기로 재지 않으면 영영 안 걸린다.
 */
export function spikes(expenses: Expense[]): Flag[] {
  const rows = expenses.filter((e) => !e.adjustment && e.amount !== 0);
  if (rows.length < ENOUGH_ROWS) return [];

  const mid = median(rows.map((e) => Math.abs(e.amount)));
  if (mid <= 0) return [];

  return rows
    .filter((e) => Math.abs(e.amount) >= mid * SPIKE_TIMES)
    .map((e) => ({
      kind: 'spike' as const,
      expenseId: e.id,
      facts: { amount: e.amount, usual: mid, times: Math.floor(Math.abs(e.amount) / mid) },
    }));
}

/** 짝수 개면 가운데 둘의 평균. 정수로 떨어뜨린다 — 이 장부에 소수점은 없다. */
export function median(ns: number[]): number {
  if (ns.length === 0) return 0;
  const s = ns.slice().sort((a, b) => a - b);
  const half = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[half] : Math.round((s[half - 1] + s[half]) / 2);
}

/* ── 영수증과 적힌 값 ─────────────────────────────────────────────────── */

/**
 * 사진에서 읽은 값과 장부에 적힌 값이 다른 줄 (§13.2)
 *
 * 38,400 을 34,800 으로 치는 일은 놀랄 만큼 흔하다. 그리고 이건 이 서비스만
 * 잡을 수 있는 종류의 오류다 — **읽은 값이 이미 있기 때문이다.** 사람이 폼에서
 * 고친 뒤에도 원래 읽은 값을 함께 남겨 두면, 나중에 둘을 견주는 것은 뺄셈이다.
 *
 * ── 다르다고 틀린 것은 아니다
 *
 * 사람이 일부러 고친 경우가 많다. 영수증 총액에 남의 몫이 섞여 있어서 빼고
 * 적었다든가, 사진이 흐려서 AI 가 잘못 읽은 것을 바로잡았다든가. 그래서 이것도
 * 물음이지 오류가 아니다. 다만 **어긋난 금액을 그대로 보여 준다** — 3,600원
 * 차이면 눈에 띄고, 그게 숫자 두 개를 바꿔 친 모양이면 사람이 바로 안다.
 */
export function offReceipt(expenses: Expense[]): Flag[] {
  return expenses
    .filter((e) => !e.adjustment && e.readAmount !== undefined && e.readAmount !== e.amount)
    .map((e) => ({
      kind: 'offReceipt' as const,
      expenseId: e.id,
      facts: {
        amount: e.amount,
        read: e.readAmount as number,
        gap: (e.readAmount as number) - e.amount,
      },
    }));
}

/* ── 빠진 사람 ────────────────────────────────────────────────────────── */

/**
 * 팀에 있는데 어느 줄에도 없는 사람 (§13.3)
 *
 * 팀원을 넣어 두고 부담자에서 빼먹는 일은 조용히 일어난다. 정산까지 가서야
 * "어 나는?" 이 나오는데, 그때는 이미 확정 단추 앞이다.
 *
 * ── 이건 짐작이 아니다
 *
 * "뒤풀이에 안 온 사람이 참여자에 들어가 있다"는 것은 이 파일이 알 수 없다 —
 * 누가 왔는지는 장부에 안 적힌다. 그래서 그건 안 묻는다. 대신 **한 번도 안
 * 나오는 사람**은 장부만 보고 확실히 알 수 있고, 그건 대개 실수다.
 *
 * 나간 팀원(active === false)은 세지 않는다. 안 나오는 것이 정상이다.
 * 공금 지출은 부담자가 없으므로 여기서도 세지 않는다.
 */
export function leftOut(ledger: Ledger, members: Member[]): Flag[] {
  const rows = ledger.expenses.filter((e) => !e.adjustment && e.allocation.type !== 'common');
  if (rows.length === 0) return [];

  const seen = new Set<MemberId>();
  for (const e of rows) {
    seen.add(e.payerId);
    const a = e.allocation;
    if (a.type === 'all') for (const id of e.teamMemberIds) seen.add(id);
    else if (a.type === 'partial') for (const id of a.participantIds) seen.add(id);
    else if (a.type === 'personal') seen.add(a.ownerId);
    else if (a.type === 'items') for (const l of a.lines) for (const id of l.memberIds) seen.add(id);
  }

  return members
    .filter((m) => m.active !== false && !seen.has(m.id))
    .map((m) => ({ kind: 'leftOut' as const, memberId: m.id, facts: { rows: rows.length } }));
}

/* ── 다 모아서 ────────────────────────────────────────────────────────── */

/**
 * 이 장부에 물을 것들 (§13)
 *
 * 사람이 이미 "괜찮다"고 답한 줄은 빠진다. 그 답은 줄에 붙어 있어서
 * (expense.checkedAt) 장부를 다시 열어도, 다른 사람이 열어도 조용하다.
 *
 * ── 순서
 *
 * 중복이 먼저다. 유일하게 **돈이 두 번 세어지는** 물음이고, 나머지 셋은
 * 한 줄의 값이 맞느냐는 물음이다. 급한 것이 위에 서야 한다.
 */
export function watch(ledger: Ledger, members: Member[]): Flag[] {
  const hushed = new Set(ledger.expenses.filter((e) => e.checkedAt).map((e) => e.id));
  const keep = (f: Flag) => !f.expenseId || !hushed.has(f.expenseId);

  return [
    ...twins(ledger.expenses),
    ...offReceipt(ledger.expenses),
    ...spikes(ledger.expenses),
    ...leftOut(ledger, members),
  ].filter(keep);
}
