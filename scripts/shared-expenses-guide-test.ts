import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sharedExpenseExample } from '../app/guides/shared-expenses/example.ts';
import { fundBook } from '../lib/domain/closing.ts';
import { computeSettlement } from '../lib/domain/settlement.ts';

test('도움말의 공금 잔액과 개인 결제 정산 금액이 함께 맞는다', () => {
  const { ledger, fund, result } = sharedExpenseExample();
  assert.equal(fund.dues, 60_000);
  assert.equal(fund.spent, 45_000);
  assert.equal(fund.left, 15_000);
  assert.equal(ledger.expenses.reduce((sum, expense) => sum + expense.amount, 0), 75_000);
  assert.equal(result.totalAmount, 30_000);
  assert.equal(result.sharedAmount, 30_000);
  assert.deepEqual(result.balances.map(member => [member.totalPaid, member.totalOwed]), [[30_000, 10_000], [0, 10_000], [0, 10_000]]);
  assert.deepEqual(result.transfers.map(transfer => [transfer.fromMemberId, transfer.toMemberId, transfer.amount]), [
    ['jiu', 'minsu', 10_000], ['seoyeon', 'minsu', 10_000],
  ]);
  assert.equal(result.balances.reduce((sum, member) => sum + member.netBalance, 0), 0);
  assert.equal(ledger.settlements.length, 0);
});

test('공금 식사비가 늘어도 개인 결제 정산에 다시 청구하지 않는다', () => {
  const { ledger, result } = sharedExpenseExample();
  ledger.expenses[0].amount = 50_000;
  assert.equal(fundBook(ledger).left, 10_000);
  assert.deepEqual(computeSettlement(ledger.expenses, ledger.members).transfers, result.transfers);
});

test('개인 결제 금액이 늘어도 공금에서 자동으로 차감하거나 상계하지 않는다', () => {
  const { ledger, fund } = sharedExpenseExample();
  ledger.expenses[1].amount = 33_000;
  assert.equal(fundBook(ledger).left, fund.left);
  const result = computeSettlement(ledger.expenses, ledger.members);
  assert.deepEqual(result.transfers.map(transfer => transfer.amount), [11_000, 11_000]);
});

test('회비가 더 들어와도 남은 공금을 개인 정산에서 자동 환급하지 않는다', () => {
  const { ledger, result } = sharedExpenseExample();
  ledger.incomes[0].amount += 5_000;
  assert.equal(fundBook(ledger).left, 20_000);
  assert.deepEqual(computeSettlement(ledger.expenses, ledger.members).transfers, result.transfers);
});
