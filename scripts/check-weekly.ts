import assert from 'node:assert/strict';
import { assessDecision, calculateWeek, readWeeklyPlan, type WeeklyPlan } from '../lib/personal/weekly.ts';

const plan: WeeklyPlan = {
  version: 1,
  currency: 'KRW',
  startingBalance: 800_000,
  payday: '2026-10-10',
  fixedBeforePayday: 200_000,
  keepAside: 100_000,
  keepAsideFor: '이사비',
  entries: [],
  pending: [],
};

assert.deepEqual(calculateWeek(plan, '2026-10-03'), {
  ready: true, days: 7, coveredDays: 7, balance: 800_000,
  committed: 0, uncommitted: 500_000, shortfall: 0, thisWeek: 500_000,
});
assert.equal(calculateWeek({ ...plan, payday: '2026-10-17' }, '2026-10-03').thisWeek, 250_000);
assert.deepEqual(assessDecision(calculateWeek({ ...plan, payday: '2026-10-17' }, '2026-10-03'), 180_000),
  { available: 500_000, after: 320_000, gap: 0, perDayBefore: 35_714, perDayAfter: 22_857 });
assert.equal(assessDecision(calculateWeek(plan, '2026-10-03'), 600_000).gap, 100_000);
assert.equal(calculateWeek({ ...plan, entries: [{ id: '1', amount: 30_000, title: '', at: '' }] }, '2026-10-03').balance, 770_000);
const reserved = { ...plan, pending: [{ id: 'trip', title: 'trip', amount: 180_000, status: 'planned' as const, createdAt: '' }] };
assert.equal(calculateWeek(reserved, '2026-10-03').uncommitted, 320_000);
assert.equal(calculateWeek({ ...plan, entries: [{ id: 'trip', title: 'trip', amount: 180_000, at: '' }] }, '2026-10-03').uncommitted, 320_000);
assert.equal(calculateWeek({ ...plan, fixedBeforePayday: 900_000 }, '2026-10-03').shortfall, 200_000);
assert.equal(calculateWeek(plan, '2026-10-10').ready, false);
assert.equal(calculateWeek({ ...plan, payday: '2026-02-30' }, '2026-02-28').ready, false);
assert.equal(readWeeklyPlan(JSON.stringify(plan))?.startingBalance, 800_000);
assert.deepEqual(readWeeklyPlan(JSON.stringify({ ...plan, pending: undefined }))?.pending, []);
assert.equal(readWeeklyPlan('{broken'), null);
assert.equal(readWeeklyPlan(JSON.stringify({ ...plan, startingBalance: -1 })), null);
console.log('weekly money checks passed');
