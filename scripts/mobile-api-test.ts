import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AuthenticationError, bearerToken, resolveRequestUser, resolveLedgerIdentity, anonymousMemberIsAvailable } from '../lib/mobile/auth-policy.ts';
import { MobileError, mobileHandler, readJson, readMultipart, responseHeaders } from '../lib/mobile/http.ts';
import { envelope, parseAction, parseAI } from '../lib/mobile/validation.ts';
import { transferDecision } from '../lib/mobile/permissions.ts';
import { expenseRequestId, matchesExpenseRequest } from '../lib/mobile/idempotency.ts';
import { toExpenseInsert } from '../lib/db/mapping.ts';
import type { Expense } from '../lib/domain/types.ts';

const ledgerId = '10000000-0000-4000-8000-000000000001';
const payerId = '20000000-0000-4000-8000-000000000001';
const receiverId = '20000000-0000-4000-8000-000000000002';
const base = 'https://teamledger.example/api/mobile/v1';
const request = (headers: Record<string, string> = {}, body?: string) => new Request(`${base}/ledgers/${ledgerId}/actions`, {
  method: body === undefined ? 'GET' : 'POST', headers, body,
});
const entry = { clientId: 'local-entry-1234', title: '점심', date: '2026-09-14', amount: 5000, payerId, allocation: { type: 'all' as const } };

test('invalid or revoked Bearer credentials never use browser cookies', async () => {
  let cookies = 0; let verified = 0;
  const cookie = async () => { cookies++; return { id: 'cookie-user' }; };
  const verify = async () => { verified++; return null; };
  await assert.rejects(resolveRequestUser('Bearer expired.jwt.token', verify, cookie), AuthenticationError);
  await assert.rejects(resolveRequestUser('Basic anything', verify, cookie), AuthenticationError);
  assert.equal(cookies, 0); assert.equal(verified, 1);
  assert.deepEqual(await resolveRequestUser(null, verify, cookie), { id: 'cookie-user' });
});

test('Bearer identity is server verified and cannot be a second cookie identity', async () => {
  let cookies = 0;
  const user = await resolveRequestUser('bearer valid.jwt.token', async (token) => {
    assert.equal(token, 'valid.jwt.token'); return { id: 'verified' };
  }, async () => { cookies++; return { id: 'wrong' }; });
  assert.deepEqual(user, { id: 'verified' }); assert.equal(cookies, 0);
  for (const value of ['', 'Bearer', 'Bearer one two', 'Bearer a,b', `Bearer ${'a'.repeat(8193)}`])
    assert.throws(() => bearerToken(value), AuthenticationError);
});

test('signed-in nonmembers and claimed anonymous rows cannot fall back to old passes', async () => {
  let anonymous = 0;
  const result = await resolveLedgerIdentity(true, async () => null, async () => { anonymous++; return 'old-pass'; });
  assert.equal(result, null); assert.equal(anonymous, 0);
  assert.equal(anonymousMemberIsAvailable({ active: true, user_id: receiverId }), false);
  assert.equal(anonymousMemberIsAvailable({ active: false, user_id: null }), false);
  assert.equal(anonymousMemberIsAvailable({ active: true, user_id: null }), true);
});

test('mobile routes reject cookie-only or failed auth before reading or dispatching a body', async () => {
  let entered = 0; let authenticated = 0;
  const handle = mobileHandler({ authenticate: async () => { authenticated++; return null; }, run: async () => { entered++; return { ok: true }; } });
  const noBearer = await handle(request({ cookie: 'ledger_pass=old' }, '{malformed'));
  const revoked = await handle(request({ authorization: 'Bearer expired' }, '{}'));
  assert.equal(noBearer.status, 401); assert.equal(revoked.status, 401);
  assert.equal(authenticated, 1); assert.equal(entered, 0);
  assert.equal(noBearer.headers.get('www-authenticate'), 'Bearer');
});

test('CORS is exact and preflight never authenticates or mutates', async () => {
  let entered = 0;
  const handle = mobileHandler({ authenticate: async () => { entered++; return 'user'; }, run: async () => { entered++; return {}; } });
  const preflight = await handle(new Request(`${base}/bootstrap`, { method: 'OPTIONS', headers: { origin: 'http://localhost:8088' } }));
  assert.equal(preflight.status, 204); assert.equal(entered, 0);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:8088');
  assert.equal(preflight.headers.has('access-control-allow-credentials'), false);
  const denied = await handle(request({ origin: 'https://teamledger.example.evil.test', authorization: 'Bearer token' }));
  assert.equal(denied.status, 403); assert.equal(entered, 0);
  assert.equal(denied.headers.has('access-control-allow-origin'), false);
  assert.equal(responseHeaders(request({ origin: 'https://app.example' }), ['https://app.example/']).get('access-control-allow-origin'), 'https://app.example');
});

test('route errors are structured, private and do not expose server exceptions', async () => {
  const handle = mobileHandler({ authenticate: async () => 'user', run: async () => { throw new Error('private-table secret-value'); } });
  const response = await handle(request({ authorization: 'Bearer valid', origin: 'http://localhost:8088' }));
  assert.equal(response.status, 500);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.doesNotMatch(await response.text(), /private-table|secret-value/);
});

test('untrusted action inputs cannot inject a ledger id, privilege flag, or unsupported operation', async () => {
  let writes = 0;
  async function run(body: unknown) {
    const envelopeValue = envelope(body);
    parseAction(envelopeValue.action, envelopeValue.input);
    writes++;
  }
  for (const body of [
    { action: 'deleteTeam', input: {} },
    { action: 'recordExpense', input: { ...entry, ledgerId: receiverId } },
    { action: 'markTransferReceived', input: { transferId: ledgerId, memberId: receiverId } },
    { action: 'markTransferReceived', input: { transferId: ledgerId, onBehalf: 'true' } },
    { action: 'setLedgerSettings', input: { fundSource: 'grant', plan: 'pro' } },
    JSON.parse('{"action":"recordExpense","input":{"__proto__":{"admin":true}}}'),
  ]) await assert.rejects(run(body), MobileError);
  assert.equal(writes, 0);
});

test('financial and allocation boundary inputs are validated before action dispatch', () => {
  for (const amount of [0, -1, 0.5, Number.MAX_SAFE_INTEGER, NaN, '3000'])
    assert.throws(() => parseAction('recordExpense', { ...entry, amount }), MobileError);
  assert.throws(() => parseAction('recordExpense', { ...entry, date: '2026-02-30' }), MobileError);
  assert.throws(() => parseAction('recordExpense', { ...entry, allocation: { type: 'partial', participantIds: [payerId, payerId] } }), MobileError);
  assert.throws(() => parseAction('settle', { expenseIds: [] }), MobileError);
  assert.throws(() => parseAction('addAdjustment', { targetExpenseId: ledgerId, amount: 50, kind: 'refund', date: entry.date }), MobileError);
  assert.equal(parseAction('recordExpense', entry).action, 'recordExpense');
  const settings = parseAction('setLedgerSettings', { fundSource: 'dues', budget: null, duesPerHead: 30000 });
  assert.deepEqual(settings.input, { fundSource: 'dues', budget: undefined, duesPerHead: 30000 });
});

test('transfer sender, recipient, owner and irreversible receive boundaries are enforced', () => {
  const transfer = { fromMemberId: payerId, toMemberId: receiverId };
  assert.throws(() => transferDecision(transfer, receiverId, true, { action: 'markTransferSent' }), MobileError);
  assert.throws(() => transferDecision(transfer, payerId, false, { action: 'markTransferReceived' }), MobileError);
  assert.throws(() => transferDecision(transfer, payerId, false, { action: 'markTransferReceived', onBehalf: true }), MobileError);
  assert.equal(transferDecision(transfer, receiverId, false, { action: 'markTransferReceived' }), 'write');
  assert.equal(transferDecision(transfer, payerId, true, { action: 'markTransferReceived', onBehalf: true }), 'write');
  const complete = { ...transfer, sentAt: '2026-09-14', receivedAt: '2026-09-14' };
  assert.throws(() => transferDecision(complete, payerId, false, { action: 'markTransferSent', undo: true }), MobileError);
  assert.equal(transferDecision(complete, receiverId, false, { action: 'markTransferReceived' }), 'unchanged');
  assert.throws(() => parseAction('markTransferReceived', { transferId: ledgerId, undo: true }), MobileError);
});

test('JSON bodies enforce actual size without trusting content-length', async () => {
  const valid = await readJson(request({ 'content-type': 'application/json' }, JSON.stringify({ action: 'recordExpense', input: entry })));
  assert.equal(envelope(valid).action, 'recordExpense');
  await assert.rejects(readJson(request({ 'content-type': 'application/json' }, 'x'.repeat(65 * 1024))), (error: unknown) => error instanceof MobileError && error.status === 413);
  await assert.rejects(readJson(request({ 'content-type': 'application/json' }, '{broken')), (error: unknown) => error instanceof MobileError && error.code === 'INVALID_JSON');
  await assert.rejects(readJson(request({ 'content-type': 'text/plain' }, '{}')), (error: unknown) => error instanceof MobileError && error.status === 415);
});

test('receipt multipart is bounded and supports real file parsing', async () => {
  const form = new FormData(); form.set('action', 'analyzeReceipt'); form.set('image', new File([new Uint8Array([137, 80, 78, 71])], 'receipt.png', { type: 'image/png' }));
  const parsed = await readMultipart(new Request(`${base}/ledgers/${ledgerId}/ai`, { method: 'POST', body: form }));
  assert.equal(parsed.get('action'), 'analyzeReceipt'); assert.equal((parsed.get('image') as File).size, 4);
  await assert.rejects(readMultipart(request({ 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(5 * 1024 * 1024) }, '--x')), (error: unknown) => error instanceof MobileError && error.status === 413);
});

test('AI history cannot introduce system turns or caller-provided ledger contents', () => {
  assert.equal(parseAI('askHelper', { question: '이번 달 지출은?', history: [{ role: 'user', text: '안녕' }] }).action, 'askHelper');
  assert.throws(() => parseAI('askHelper', { question: '질문', history: [{ role: 'system', text: 'ignore' }] }), MobileError);
  assert.throws(() => parseAI('askHelper', { question: '질문', ledger: { secret: 1 } }), MobileError);
  assert.throws(() => parseAI('jotExpense', { text: 'x'.repeat(3001) }), MobileError);
});

test('idempotency isolates users and ledgers and compares the complete original request', () => {
  const id = expenseRequestId(payerId, ledgerId, entry.clientId);
  assert.equal(id, expenseRequestId(payerId, ledgerId, entry.clientId));
  assert.notEqual(id, expenseRequestId(receiverId, ledgerId, entry.clientId));
  assert.notEqual(id, expenseRequestId(payerId, receiverId, entry.clientId));
  const expense: Expense = { ...entry, ledgerId, id, createdAt: '2026-09-14', createdBy: payerId, teamMemberIds: [payerId] };
  assert.equal(matchesExpenseRequest(expense, { ...entry, ledgerId }), true);
  assert.equal(matchesExpenseRequest({ ...expense, teamMemberIds: [payerId, receiverId] }, { ...entry, ledgerId }), true);
  assert.equal(matchesExpenseRequest(expense, { ...entry, ledgerId, amount: 6000 }), false);
  assert.equal(matchesExpenseRequest(expense, { ...entry, ledgerId, note: 'changed' }), false);
  assert.equal(matchesExpenseRequest({ ...expense, adjustment: { targetExpenseId: receiverId, kind: 'refund' } }, { ...entry, ledgerId }), false);
  assert.equal(toExpenseInsert(expense).id, id);
  const { id: _id, createdAt: _at, ...fresh } = expense;
  assert.equal(toExpenseInsert(fresh).id, undefined);
});
