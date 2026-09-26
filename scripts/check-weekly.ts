import assert from 'node:assert/strict';
import { calculateWeek, readWeeklyPlan, weekSuggestions, type WeeklyPlan } from '../lib/personal/weekly.ts';

const plan: WeeklyPlan = {
  version: 1,
  currency: 'KRW',
  startingBalance: 800_000,
  payday: '2026-10-10',
  fixedBeforePayday: 200_000,
  keepAside: 100_000,
  entries: [],
};

assert.deepEqual(calculateWeek(plan, '2026-10-03'), {
  ready: true, days: 7, coveredDays: 7, balance: 800_000,
  uncommitted: 500_000, shortfall: 0, thisWeek: 500_000,
});
assert.equal(calculateWeek({ ...plan, payday: '2026-10-17' }, '2026-10-03').thisWeek, 250_000);
assert.deepEqual(weekSuggestions(calculateWeek({ ...plan, payday: '2026-10-17' }, '2026-10-03')),
  { less: 200_000, even: 250_000, more: 300_000 });
assert.deepEqual(weekSuggestions(calculateWeek(plan, '2026-10-03')),
  { less: 400_000, even: 500_000, more: 500_000 });
assert.equal(calculateWeek({ ...plan, entries: [{ id: '1', amount: 30_000, title: '', at: '' }] }, '2026-10-03').balance, 770_000);
assert.equal(calculateWeek({ ...plan, fixedBeforePayday: 900_000 }, '2026-10-03').shortfall, 200_000);
assert.equal(calculateWeek(plan, '2026-10-10').ready, false);
assert.equal(calculateWeek({ ...plan, payday: '2026-02-30' }, '2026-02-28').ready, false);
assert.equal(readWeeklyPlan(JSON.stringify(plan))?.startingBalance, 800_000);
assert.equal(readWeeklyPlan('{broken'), null);
assert.equal(readWeeklyPlan(JSON.stringify({ ...plan, startingBalance: -1 })), null);
console.log('weekly money checks passed');
