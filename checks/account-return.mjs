/** Account deletion login return path. Actual pages/actions/callback, isolated auth/cookie mocks only. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(path.join(root, 'package.json'))('typescript');
function load(relative, imports) {
  const module = { exports: {} }, filename = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, FormData, Error,
    process: { env: { NODE_ENV: 'test' } },
    require(id) { if (!(id in imports)) throw new Error(`Unexpected import ${id}`); return imports[id]; },
    fetch() { throw new Error('Network disabled'); },
  }, { filename });
  return module.exports;
}
class Redirect extends Error { constructor(location) { super('fixture redirect'); this.location = location; } }
const redirect = location => { throw new Redirect(location); };
const destination = '/account#delete-account', origin = 'https://teamledger.net';
const jsx = (type, props) => ({ type, props }), runtime = { jsx, jsxs: jsx };
const page = load('app/account/page.tsx', {
  'react/jsx-runtime': runtime, 'next/link': {}, 'next/navigation': { redirect },
  '../../lib/lang.ts': { getLang: async () => 'ko' }, '../../lib/auth-client.ts': { currentUser: async () => null },
  '../../lib/db/account.ts': { accountFacts: () => { throw new Error('Unauthenticated account facts must not run'); } },
  '../../lib/i18n.ts': {}, '../SignOut.tsx': {}, './Withdraw.tsx': {},
});
async function accountRedirect(intent) {
  try { await page.default({ searchParams: Promise.resolve({ intent }) }); assert.fail('Expected login redirect'); }
  catch (error) { assert.ok(error instanceof Redirect); return new URL(error.location, origin); }
}
const loginUrl = await accountRedirect('delete');
assert.equal(loginUrl.pathname, '/login');
assert.equal(loginUrl.searchParams.get('next'), destination);
assert.equal((await accountRedirect(undefined)).searchParams.get('next'), '/account');
assert.equal((await accountRedirect('https://example.invalid')).searchParams.get('next'), '/account');

const jarValues = new Map(), calls = [];
const jar = { get: key => jarValues.has(key) ? { value: jarValues.get(key) } : undefined,
  set: (key, value) => jarValues.set(key, value), delete: key => jarValues.delete(key) };
let callbackError = null;
const auth = { auth: {
  signInWithOtp: async input => { calls.push(['email', input]); return { error: null }; },
  signInWithOAuth: async input => { calls.push(['oauth', input]); return { data: { url: 'https://accounts.google.com/fixture-only' }, error: null }; },
  verifyOtp: async input => { calls.push(['verify', input]); return { error: callbackError }; },
  exchangeCodeForSession: async input => { calls.push(['exchange', input]); return { error: callbackError }; },
} };
const actions = load('app/actions/auth.ts', {
  'next/headers': { cookies: async () => jar }, 'next/navigation': { redirect },
  '../../lib/auth-client.ts': { authClient: async () => auth }, '../../lib/access.ts': { clearPass: async () => {} },
  '../../lib/origin.ts': { siteOrigin: async () => origin },
});
const callback = load('app/auth/callback/route.ts', {
  'next/headers': { cookies: async () => jar }, 'next/server': { NextResponse: { redirect: url => ({ location: url }) } },
  '../../../lib/auth-client.ts': { authClient: async () => auth },
});
const login = load('app/login/page.tsx', {
  'react/jsx-runtime': runtime, 'next/navigation': { redirect }, './AuthForm.tsx': { default: 'AuthForm' },
  '../../lib/auth-client.ts': { currentUser: async () => null }, '../actions/auth.ts': actions,
  '../../lib/lang.ts': { getLang: async () => 'ko' }, '../../lib/i18n.ts': { translator: () => key => key },
  '../helper/HelperContext.tsx': { Say: 'Say' }, '../Logo.tsx': { default: 'Logo' },
});
const view = await login.default({ searchParams: Promise.resolve({ next: loginUrl.searchParams.get('next') }) });
const form = view.props.children.find(child => child?.type === 'AuthForm');
assert.equal(form.props.next, destination);

const input = new FormData(); input.set('email', 'fixture@example.invalid'); input.set('next', form.props.next);
assert.equal((await actions.sendEmailLink(input)).ok, true);
const emailCallback = new URL(calls.find(([kind]) => kind === 'email')[1].options.emailRedirectTo);
assert.equal(emailCallback.origin, origin); assert.equal(emailCallback.searchParams.get('next'), destination);
assert.equal(emailCallback.hash, '', 'Fragment is part of encoded next, not the callback fragment');
jarValues.clear(); // Simulate opening the email in a browser without the login cookie.
emailCallback.searchParams.set('token_hash', 'fixture-token'); emailCallback.searchParams.set('type', 'email');
assert.equal((await callback.GET({ url: emailCallback.href })).location, origin + destination);

await assert.rejects(() => form.props.google(), error => error instanceof Redirect);
const oauthCallback = new URL(calls.find(([kind]) => kind === 'oauth')[1].options.redirectTo);
assert.equal(oauthCallback.searchParams.get('next'), destination);
oauthCallback.searchParams.set('code', 'fixture-code');
assert.equal((await callback.GET({ url: oauthCallback.href })).location, origin + destination);

callbackError = { message: 'fixture expired token' };
const retry = new URL((await callback.GET({ url: emailCallback.href })).location);
assert.equal(retry.pathname, '/login'); assert.equal(retry.searchParams.get('next'), destination);
callbackError = null;
for (const unsafe of ['https://example.invalid', '//example.invalid', '/\\example.invalid']) {
  jarValues.clear();
  const unsafeCallback = new URL('/auth/callback', origin);
  unsafeCallback.searchParams.set('next', unsafe); unsafeCallback.searchParams.set('code', 'fixture-code');
  assert.equal((await callback.GET({ url: unsafeCallback.href })).location, origin + '/teams');
}
console.log('PASS delete intent → deletion anchor; normal/unknown intent → account; login next → email/OAuth callback, email without cookie, retry and existing internal-path guard; no network or auth requests');
