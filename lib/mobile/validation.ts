import type { Allocation } from '../domain/types.ts';
import { MobileError } from './http.ts';

const bad = (message = '입력 내용을 확인해 주세요.'): never => { throw new MobileError(400, 'INVALID_INPUT', message); };
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) return bad('지원하지 않는 입력 항목이 있습니다.');
  return record;
}
export function text(value: unknown, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return bad();
  return value.trim();
}
export function optionalText(value: unknown, max = 1000): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : text(value, max);
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return bad('항목을 찾을 수 없습니다.');
  return value.toLowerCase();
}
export function amount(value: unknown, signed = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0 || (!signed && value < 0) || Math.abs(value) > 1_000_000_000_000) return bad('금액을 확인해 주세요.');
  return value;
}
export function optionalAmount(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : amount(value);
}
export function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : bad(); }
export function enumeration<T extends string>(value: unknown, values: readonly T[]): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : bad();
}
export function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return bad('날짜를 확인해 주세요.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '1900-01-01') return bad('날짜를 확인해 주세요.');
  return value;
}
export function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return bad('항목을 하나 이상 골라 주세요.');
  const result = value.map(uuid);
  if (new Set(result).size !== result.length) return bad('같은 항목이 중복되어 있습니다.');
  return result;
}
export function allocation(value: unknown): Allocation {
  const a = object(value, ['type', 'participantIds', 'ownerId', 'lines']);
  switch (a.type) {
    case 'all': case 'common': object(a, ['type']); return { type: a.type };
    case 'partial': object(a, ['type', 'participantIds']); return { type: 'partial', participantIds: ids(a.participantIds) };
    case 'personal': object(a, ['type', 'ownerId']); return { type: 'personal', ownerId: uuid(a.ownerId) };
    case 'items': {
      object(a, ['type', 'lines']);
      if (!Array.isArray(a.lines) || a.lines.length === 0 || a.lines.length > 100) return bad('품목을 확인해 주세요.');
      return { type: 'items', lines: a.lines.map((value) => {
        const line = object(value, ['name', 'amount', 'memberIds']);
        return { name: text(line.name), amount: amount(line.amount, true), memberIds: ids(line.memberIds) };
      }) };
    }
    default: return bad('나눌 방식을 확인해 주세요.');
  }
}

export function envelope(value: unknown) {
  const body = object(value, ['action', 'input']);
  return { action: text(body.action, 60), input: body.input ?? {} };
}

export function parseAction(action: string, value: unknown) {
  switch (action) {
    case 'recordExpense': {
      const i = object(value, ['clientId', 'date', 'title', 'amount', 'payerId', 'allocation', 'vendor', 'category', 'group', 'note', 'readAmount']);
      const clientId = optionalText(i.clientId, 128);
      if (clientId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(clientId)) return bad('기록 번호를 확인해 주세요.');
      return { action, input: { clientId, date: date(i.date), title: text(i.title), amount: amount(i.amount), payerId: uuid(i.payerId), allocation: allocation(i.allocation),
        vendor: optionalText(i.vendor, 160), category: optionalText(i.category, 80), group: optionalText(i.group, 120), note: optionalText(i.note, 2000),
        readAmount: i.readAmount === undefined ? undefined : amount(i.readAmount) } } as const;
    }
    case 'recordIncome': {
      const i = object(value, ['date', 'title', 'amount', 'kind', 'memberId', 'note']);
      return { action, input: { date: date(i.date), title: text(i.title), amount: amount(i.amount), kind: enumeration(i.kind, ['dues', 'grant', 'donation', 'carryover']),
        memberId: i.memberId === undefined || i.memberId === null ? undefined : uuid(i.memberId), note: optionalText(i.note, 2000) } } as const;
    }
    case 'setBookKind': {
      const i = object(value, ['fundSource', 'termCarry', 'duesPerHead']);
      return { action, input: { fundSource: enumeration(i.fundSource, ['each', 'dues', 'grant']), termCarry: bool(i.termCarry), duesPerHead: optionalAmount(i.duesPerHead) } } as const;
    }
    case 'setLedgerSettings': {
      const i = object(value, ['fundSource', 'duesPerHead', 'budget']);
      return { action, input: { fundSource: enumeration(i.fundSource, ['each', 'dues', 'grant']), duesPerHead: optionalAmount(i.duesPerHead), budget: optionalAmount(i.budget) } } as const;
    }
    case 'setBudget': {
      const i = object(value, ['budget']);
      return { action, input: { budget: optionalAmount(i.budget) } } as const;
    }
    case 'closeTerm': return { action, input: { closed: bool(object(value, ['closed']).closed) } } as const;
    case 'settle': {
      const i = object(value, ['expenseIds', 'label', 'isFinal']);
      return { action, input: { expenseIds: i.expenseIds === undefined ? undefined : ids(i.expenseIds), label: optionalText(i.label, 80), isFinal: i.isFinal === undefined ? undefined : bool(i.isFinal) } } as const;
    }
    case 'markTransferSent': {
      const i = object(value, ['transferId', 'undo']);
      return { action, input: { transferId: uuid(i.transferId), undo: i.undo === undefined ? undefined : bool(i.undo) } } as const;
    }
    case 'markTransferReceived': {
      const i = object(value, ['transferId', 'onBehalf']);
      return { action, input: { transferId: uuid(i.transferId), onBehalf: i.onBehalf === undefined ? undefined : bool(i.onBehalf) } } as const;
    }
    case 'markChecked': {
      const i = object(value, ['expenseId', 'checked']);
      return { action, input: { expenseId: uuid(i.expenseId), checked: bool(i.checked) } } as const;
    }
    case 'addAdjustment': {
      const i = object(value, ['targetExpenseId', 'amount', 'kind', 'date', 'reason']);
      const kind = enumeration(i.kind, ['refund', 'correction']);
      const difference = amount(i.amount, true);
      if (kind === 'refund' && difference >= 0) return bad('환불 금액은 음수로 보내 주세요.');
      return { action, input: { targetExpenseId: uuid(i.targetExpenseId), amount: difference, kind, date: date(i.date), reason: optionalText(i.reason, 1000) } } as const;
    }
    default: throw new MobileError(400, 'UNKNOWN_ACTION', '지원하지 않는 작업입니다.');
  }
}

export function parseAI(action: string, value: unknown) {
  if (action === 'askHelper') {
    const i = object(value, ['question', 'history']);
    const history = i.history ?? [];
    if (!Array.isArray(history) || history.length > 6) return bad('최근 대화 6개까지 보낼 수 있습니다.');
    return { action, input: { question: text(i.question, 500), history: history.map((value) => {
      const turn = object(value, ['role', 'text']);
      return { role: enumeration(turn.role, ['user', 'assistant']), text: text(turn.text, 1000) };
    }) } } as const;
  }
  if (action === 'jotExpense' || action === 'jotIncomeLine') {
    const i = object(value, ['text']);
    return { action, input: { text: text(i.text, 3000) } } as const;
  }
  if (action === 'askToPay') {
    const i = object(value, ['toMemberId', 'why', 'warm', 'lang']);
    return { action, input: { toMemberId: uuid(i.toMemberId), why: enumeration(i.why, ['transfer', 'dues']), warm: bool(i.warm),
      lang: enumeration(i.lang, ['ko', 'en', 'ja', 'zh', 'es', 'vi']) } } as const;
  }
  throw new MobileError(400, 'UNKNOWN_ACTION', '지원하지 않는 AI 작업입니다.');
}
