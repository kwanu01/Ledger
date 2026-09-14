/**
 * Regression checks for the six bugs found in the received web source.
 * No real AI, database, or application endpoint is called.
 * Source modules are transpiled in memory; every dependency is a local mock.
 * Run: node checks/handoff-repro.mjs [optional-web-source-directory]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sourceRoot = process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(sourceRoot, 'package.json'));
const ts = require('typescript');
const usage = { model: 'mock', inputTokens: 1, outputTokens: 1, costMicroUsd: 1 };
const reservationId = '00000000-0000-4000-8000-000000000001';
const models = { MODEL: 'mock', ITEM_MODEL: 'mock-items', meter: () => usage, ENDPOINT: 'mock:no-network' };
const results = [];

function load(relativeFile, imports = {}, extra = {}) {
  const filename = path.join(sourceRoot, relativeFile);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    // Unused source imports are inert objects, never evaluated or loaded.
    require: id => imports[id] ?? {},
    process: { env: { ANTHROPIC_API_KEY: 'TEST_ONLY_NO_NETWORK', LEDGER_AI_ASK_TIMEOUT_MS: '5', LEDGER_AI_JOT_TIMEOUT_MS: '5' } },
    Buffer, File, AbortController, setTimeout, clearTimeout,
    fetch: async () => { throw new Error('External network disabled in this check'); },
    ...extra,
  }, { filename });
  return module.exports;
}

// 1. The display fallback must never be mistaken for an independently read total.
const rawReceipt = { lines: [{ name: 'coffee', qty: 1, amount: 500, kind: 'item' }], currency: 'KRW' };
const items = load('lib/ai/items.ts', {
  './call.ts': {
    callTool: async () => ({
      ok: true,
      input: rawReceipt,
      usage,
    }),
  },
  './usage.ts': { ITEM_MODEL: 'mock' },
});
const itemResult = await items.readReceiptLines({ base64: 'x', mediaType: 'image/jpeg' });
assert.equal(itemResult.ok, true);
assert.equal(itemResult.value.total, 500);
assert.equal(itemResult.value.balanced, false);
assert.equal(itemResult.value.totalRead, false);
for (const total of [null, 0, -500, '500', 500.1, Number.MAX_SAFE_INTEGER + 1, 500, 550]) {
  rawReceipt.total = total;
  const { value } = await items.readReceiptLines({ base64: 'x', mediaType: 'image/jpeg' });
  assert.equal(value.totalRead, total === 500 || total === 550);
  assert.equal(value.balanced, total === 500);
}
results.push({ check: 'missing/invalid printed total never balanced; valid totals still verified', passed: true });

// 2. The authenticated member is not the roster's first member.
let observedMe;
const income = load('app/actions/receipt.ts', {
  '../../lib/access.ts': {
    requireLedgerAccess: async () => ({ memberId: 'second' }),
    AccessError: class extends Error {},
  },
  '../../lib/db/repo.ts': {
    MONTHLY_AI_LIMIT: 200,
    reserveAiUsage: async () => reservationId,
    AiUsageError: class extends Error {},
    recordAiUsage: async () => {},
    loadLedger: async () => ({ members: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }] }),
  },
  '../../lib/ai/usage.ts': models,
  '../../lib/domain/closing.ts': { usesFund: () => true, collectsDues: () => true },
  '../../lib/ai/income.ts': {
    jotIncome: async args => {
      observedMe = args.me;
      return { ok: true, value: { title: 'dues', kind: 'dues', payerName: args.me, amount: 30000, missing: [] }, usage };
    },
  },
});
const incomeResult = await income.jotIncomeLine({ ledgerId: 'ledger', text: '내가 낸 회비 3만원' });
assert.equal(incomeResult.ok, true);
assert.equal(observedMe, 'Second');
assert.equal(incomeResult.value.memberId, 'second');
results.push({ check: 'authenticated second member', mePassedToModel: observedMe, returnedMemberId: incomeResult.value.memberId });

// 3. The deadline must include body reading, even when the reader ignores abort.
let signal;
const transport = load('lib/ai/request.ts', {
  './usage.ts': models,
}, {
  fetch: async (_url, init) => {
    signal = init.signal;
    return {
      ok: true,
      json: async () => {
        await new Promise(resolve => setTimeout(resolve, 45));
        return { content: [{ type: 'tool_use', name: 'mock', input: { ok: true } }] };
      },
    };
  },
});
const call = load('lib/ai/call.ts', { './usage.ts': models, './request.ts': transport });
const began = Date.now();
const callResult = await call.callTool({ model: 'mock', timeoutMs: 5, maxTokens: 5, tool: { name: 'mock', description: 'mock', input_schema: {} }, prompt: 'test' });
assert.equal(callResult.ok, false);
assert.equal(signal.aborted, true);
assert.match(callResult.message, /늦어지고/);
results.push({ check: 'slow response body', timeoutMs: 5, elapsedMs: Date.now() - began, signalAborted: signal.aborted, ok: callResult.ok });

// 4. Usage queries, reservations and completion writes all fail closed.
const failedUpdate = {
  update: () => failedUpdate, eq: () => failedUpdate, select: () => failedUpdate,
  single: async () => ({ data: null, error: { message: 'mock update failure' } }),
};
const failingUsageRepo = load('lib/db/repo.ts', {
  react: { cache: f => f },
  './client.ts': {
    db: {
      rpc: async () => ({ data: null, error: { message: 'mock database failure' } }),
      from: () => failedUpdate,
    },
  },
});
await assert.rejects(() => failingUsageRepo.aiUsageThisMonth('ledger'), /사용량/);
await assert.rejects(() => failingUsageRepo.reserveAiUsage('ledger', 'mock'), /사용량/);
await assert.rejects(() => failingUsageRepo.recordAiUsage({ ledgerId: 'ledger', reservationId, ...usage, succeeded: true }), /저장/);
assert.equal(await failingUsageRepo.aiReservationReady(), false);
results.push({ check: 'usage database failures rejected', passed: true });

// 5. This mocks the atomic RPC contract; it does NOT prove PostgreSQL locking.
let count = 199;
let modelCalls = 0;
let completionCalls = 0;
let modelFails = false;
let completionFails = false;
const quotaQuery = {
  update: () => { completionCalls++; return quotaQuery; }, eq: () => quotaQuery, select: () => quotaQuery,
  single: async () => completionFails ? { data: null, error: { message: 'mock failure' } } : { data: { id: reservationId }, error: null },
};
const quotaRepo = load('lib/db/repo.ts', {
  react: { cache: f => f },
  './client.ts': { db: {
    rpc: async name => {
      assert.equal(name, 'reserve_ai_usage');
      if (count >= 200) return { data: null, error: null };
      count++;
      return { data: reservationId, error: null };
    },
    from: () => quotaQuery,
  } },
});
const ask = load('app/actions/ask.ts', {
  '../../lib/access.ts': {
    requireLedgerAccess: async () => ({ memberId: 'me' }),
    AccessError: class extends Error {},
  },
  '../../lib/db/repo.ts': {
    ...quotaRepo,
    loadLedger: async () => ({}),
  },
  '../../lib/ai/usage.ts': models,
  '../../lib/ai/ask.ts': { askAboutLedger: async () => {
    modelCalls++;
    return modelFails ? { ok: false, message: 'mock uncertain upstream failure' } : { ok: true, answer: 'mock', usage };
  } },
});
const replies = await Promise.all([1, 2, 3].map(() => ask.askHelper({ ledgerId: 'ledger', question: '질문', history: [] })));
assert.equal(count, 200);
assert.equal(replies.filter(r => r.ok).length, 1);
assert.equal(modelCalls, 1);
assert.equal(completionCalls, 1);
results.push({ check: 'monthly limit action concurrency with mock atomic RPC', started: 199, limit: 200, accepted: 1, ended: count });
count = 199;
modelFails = true;
assert.equal((await ask.askHelper({ ledgerId: 'ledger', question: '질문', history: [] })).ok, false);
assert.equal(count, 200); // Failed/uncertain call still consumes the reservation.
count = 199;
modelFails = false;
completionFails = true;
const completionError = await ask.askHelper({ ledgerId: 'ledger', question: '질문', history: [null] });
assert.equal(completionError.ok, false);
assert.match(completionError.message, /저장하지 못했습니다/);
results.push({ check: 'uncertain failures retain reservation and completion errors are visible', passed: true });

// 6. Every child query is required, but legitimate empty arrays remain valid.
let failingChild = 'all';
const db = {
  from: name => {
    const result = name === 'ledgers'
      ? { data: { team_id: 'team', teams: { name: 'Team' } }, error: null }
      : failingChild === 'all' || name === failingChild
        ? { data: null, error: { message: 'mock child query failed' } }
        : { data: [], count: failingChild === `truncate-${name}` ? 1 : 0, error: null };
    const query = {
      select: (_columns, options) => { if (name !== 'ledgers') assert.equal(options?.count, 'exact'); return query; }, eq: () => query, order: () => query,
      single: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return query;
  },
};
const failingLedgerRepo = load('lib/db/repo.ts', {
  react: { cache: f => f },
  './client.ts': { db },
  './mapping.ts': { toLedger: (_ledger, _name, members, expenses, settlements, incomes) => ({ members, expenses, settlements, incomes }) },
});
for (const child of ['all', 'members', 'expenses', 'settlements', 'incomes', 'truncate-members', 'truncate-expenses', 'truncate-settlements', 'truncate-incomes']) {
  failingChild = child;
  await assert.rejects(() => failingLedgerRepo.loadLedger('ledger'), /모두 읽지 못했습니다/);
}
failingChild = '';
const emptyLedger = await failingLedgerRepo.loadLedger('ledger');
assert.deepEqual(Object.values(emptyLedger).map(x => x.length), [0, 0, 0, 0]);
results.push({ check: 'child failures/truncated arrays rejected; genuinely empty ledger allowed', passed: true });

// Additional transport cases ensure both previous direct-fetch consumers stay bounded.
for (const phase of ['headers', 'error-body', 'malformed-json', 'malformed-shape']) {
  const request = load('lib/ai/request.ts', { './usage.ts': models }, {
    fetch: async () => {
      if (phase === 'headers') return new Promise(() => {});
      if (phase === 'error-body') return { ok: false, status: 503, text: () => new Promise(() => {}) };
      return { ok: true, json: async () => { if (phase === 'malformed-json') throw new SyntaxError('mock invalid JSON'); return null; } };
    },
  });
  assert.equal((await request.requestMessage({}, 5)).ok, false);
}
const jot = load('lib/ai/jot.ts', { './usage.ts': models, './call.ts': call });
const chat = load('lib/ai/ask.ts', { './usage.ts': models, './request.ts': transport });
assert.equal((await jot.jot({ text: 'coffee 500', today: '2026-09-14', names: ['Second'], me: 'Second', currency: 'KRW' })).ok, false);
assert.equal((await chat.askAnything({ question: 'hello', history: [] })).ok, false);
results.push({ check: 'chat/jot/header/error-body deadlines and malformed-body handling', passed: true });

for (const limit of ['0', '-1', 'abc', '2.5', '2147483648']) {
  let calls = 0;
  const invalid = load('lib/db/repo.ts', { react: { cache: f => f }, './client.ts': { db: { rpc: async () => { calls++; return { data: reservationId }; } } } },
    { process: { env: { ANTHROPIC_API_KEY: 'MOCK_ONLY', LEDGER_AI_MONTHLY_LIMIT: limit } } });
  await assert.rejects(() => invalid.reserveAiUsage('ledger', 'mock'), /설정/);
  assert.equal(await invalid.aiReservationReady(), false);
  assert.equal(calls, 0);
}
results.push({ check: 'invalid configured monthly limits fail before RPC', passed: true });

console.log(JSON.stringify({ externalRequests: 0, sourceEdits: 0, passedGroups: results.length, postgresConcurrencyVerified: false, concurrencyScope: 'mock RPC contract only; isolated database verification required before deployment', results }, null, 2));
