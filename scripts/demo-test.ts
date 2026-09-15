import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateDemo, demoShareText, starterEntries } from '../lib/demo.ts';

test('정산 예시는 세 사람의 실제 결제와 두 사람만 나누는 지출을 함께 반영한다', () => {
  const { result } = calculateDemo(starterEntries);
  assert.ok(result);
  assert.equal(result.totalAmount, 93000);
  assert.deepEqual(result.balances.map(member => [member.totalPaid, member.totalOwed]), [[48000, 22000], [27000, 35500], [18000, 35500]]);
  assert.equal(result.transfers.find(transfer => transfer.fromMemberId === 'jiu')?.amount, 8500);
  assert.equal(result.transfers.find(transfer => transfer.fromMemberId === 'seoyeon')?.amount, 17500);
});

test('참여자 변경은 결제액을 바꾸지 않고 나눠 낼 금액만 다시 계산한다', () => {
  const result = calculateDemo(starterEntries.map(entry => ({ ...entry, together: true }))).result!;
  assert.equal(result.totalAmount, 93000);
  assert.deepEqual(result.balances.map(member => member.totalOwed), [31000, 31000, 31000]);
  assert.deepEqual(result.balances.map(member => member.totalPaid), [48000, 27000, 18000]);
});

test('최솟값·큰 금액·나머지가 있는 금액에서도 실제 송금 뒤 모든 차액은 0이다', () => {
  for (const amount of ['1', '2', '101', '100003', '100000000']) {
    for (const together of [true, false]) {
      const result = calculateDemo(starterEntries.map(entry => ({ ...entry, amount, together }))).result!;
      assert.ok(result);
      assert.equal(result.balances.reduce((sum, member) => sum + member.totalOwed, 0), result.totalAmount);
      const balances = new Map(result.balances.map(member => [member.memberId, member.netBalance]));
      for (const transfer of result.transfers) {
        assert.ok(Number.isSafeInteger(transfer.amount) && transfer.amount > 0);
        balances.set(transfer.fromMemberId, balances.get(transfer.fromMemberId)! + transfer.amount);
        balances.set(transfer.toMemberId, balances.get(transfer.toMemberId)! - transfer.amount);
      }
      assert.ok([...balances.values()].every(value => value === 0));
    }
  }
});

test('잘못된 금액은 결과와 공유를 함께 차단하며 보정하지 않는다', () => {
  for (const amount of ['', '0', '-1', '1.1', '1e4', 'NaN', 'Infinity', '100000001', '1,,2', '1,00', '1 000', '₩1000']) {
    const entries = starterEntries.map(entry => entry.id === 'lunch' ? { ...entry, amount } : entry);
    assert.equal(calculateDemo(entries).result, null, amount);
    assert.ok(calculateDemo(entries).errors.lunch, amount);
    assert.equal(demoShareText(entries), null);
  }
});

test('올바른 쉼표 금액은 입력의 의미를 유지한다', () => {
  const entries = starterEntries.map(entry => ({ ...entry, amount: Number(entry.amount).toLocaleString('ko-KR') }));
  assert.equal(calculateDemo(entries).result?.totalAmount, 93000);
});

test('공유 내용은 가상 기록임을 밝히고 URL에 금액·이름을 싣지 않는다', () => {
  const text = demoShareText(starterEntries)!;
  assert.match(text, /가상의 이름과 기록/);
  assert.match(text, /93,000원/);
  const link = text.split('\n').at(-1)!;
  assert.equal(link, 'https://teamledger.net/demo?ref=share');
  assert.equal(new URL(link).searchParams.size, 1);
});
