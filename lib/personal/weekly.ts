import type { CurrencyCode } from '../domain/money.ts';

export type BudgetEntry = { id: string; amount: number; title: string; at: string };
export type WeeklyPlan = {
  version: 1;
  currency: CurrencyCode;
  startingBalance: number;
  payday: string;
  fixedBeforePayday: number;
  keepAside: number;
  entries: BudgetEntry[];
};

const dayNumber = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const [year, month, day] = date.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? utc / 86_400_000 : NaN;
};

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calculateWeek(plan: WeeklyPlan, today: string) {
  const days = dayNumber(plan.payday) - dayNumber(today);
  const balance = plan.startingBalance - plan.entries.reduce((sum, entry) => sum + entry.amount, 0);
  const uncommitted = balance - plan.fixedBeforePayday - plan.keepAside;
  const ready = Number.isFinite(days) && days > 0;
  const coveredDays = ready ? Math.min(7, days) : 0;
  return {
    ready,
    days: ready ? days : 0,
    coveredDays,
    balance,
    uncommitted,
    shortfall: Math.max(0, -uncommitted),
    thisWeek: ready ? Math.floor(Math.max(0, uncommitted) * coveredDays / days) : 0,
  };
}

export function readWeeklyPlan(value: string | null): WeeklyPlan | null {
  if (!value) return null;
  try {
    const p: unknown = JSON.parse(value);
    if (!p || typeof p !== 'object') return null;
    const raw = p as Partial<WeeklyPlan>;
    const money = [raw.startingBalance, raw.fixedBeforePayday, raw.keepAside];
    if (raw.version !== 1 || !raw.currency || !['KRW', 'JPY', 'CNY', 'VND', 'USD', 'EUR', 'GBP'].includes(raw.currency)
      || !raw.payday || !Number.isFinite(dayNumber(raw.payday))
      || money.some((n) => !Number.isSafeInteger(n) || (n ?? -1) < 0)
      || !Array.isArray(raw.entries)) return null;
    const entries = raw.entries.filter((entry): entry is BudgetEntry =>
      !!entry && typeof entry.id === 'string' && typeof entry.title === 'string'
      && typeof entry.at === 'string' && Number.isSafeInteger(entry.amount) && entry.amount > 0);
    return { ...raw, entries } as WeeklyPlan;
  } catch {
    return null;
  }
}
