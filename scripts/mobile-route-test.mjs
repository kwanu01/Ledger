/** Real Next route smoke tests. All credentials and database rows below are disposable local fixtures. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

const ledgerId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const teamId = '30000000-0000-4000-8000-000000000001';
const fixtureToken = 'fixture.valid.token';
let authCalls = 0;
let mutationCalls = 0;
const fixture = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method !== 'GET') {
    mutationCalls++;
    response.writeHead(405).end(JSON.stringify({ message: 'Fixture never writes' }));
    return;
  }
  const path = new URL(request.url, 'http://fixture.local').pathname;
  if (path === '/auth/v1/user') {
    authCalls++;
    if (request.headers.authorization !== `Bearer ${fixtureToken}`) {
      response.writeHead(401).end(JSON.stringify({ code: 'bad_jwt', message: 'Invalid JWT' }));
      return;
    }
    response.end(JSON.stringify({ id: userId, aud: 'authenticated', role: 'authenticated',
      email: 'fixture@example.invalid', app_metadata: { provider: 'email' }, user_metadata: { display_name: '테스트' }, created_at: '2026-09-14T00:00:00Z' }));
    return;
  }
  if (path === '/rest/v1/ledgers') {
    response.setHeader('Content-Range', '0-0/1');
    response.end(JSON.stringify([{ id: ledgerId, team_id: teamId }]));
    return;
  }
  if (path === '/rest/v1/members') {
    response.setHeader('Content-Range', '*/0');
    response.end('[]'); // This verified account is deliberately outside the fixture team.
    return;
  }
  response.writeHead(404).end(JSON.stringify({ message: 'Unexpected fixture request' }));
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function freePort() {
  const server = createServer(); const port = await listen(server);
  await new Promise((done) => server.close(done)); return port;
}
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function withNext(extra, run) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}/api/mobile/v1`;
  const env = { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
    ANTHROPIC_API_KEY: '', LEDGER_COOKIE_SECRET: '', NEXT_PUBLIC_SITE_URL: '', MOBILE_ALLOWED_ORIGINS: '', ...extra };
  const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { logs = (logs + chunk.toString()).slice(-10000); });
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Next exited: ${logs}`);
      try { await fetch(`${base}/config`, { signal: AbortSignal.timeout(3000) }); break; }
      catch { await delay(250); }
    }
    await run(base);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : error}\nNext fixture log:\n${logs}`);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), delay(5000).then(() => child.kill('SIGKILL'))]);
  }
}

try {
  await withNext({}, async (base) => {
    const response = await fetch(`${base}/config`, { headers: { origin: 'http://localhost:8088' } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'NOT_CONFIGURED');
    const protectedRoute = await fetch(`${base}/bootstrap`, { headers: { authorization: 'Bearer placeholder' } });
    assert.equal(protectedRoute.status, 503);
    const cookieOnly = await fetch(`${base}/bootstrap`, { headers: { cookie: 'ledger_pass=old' } });
    assert.equal(cookieOnly.status, 401);
    const options = await fetch(`${base}/bootstrap`, { method: 'OPTIONS', headers: { origin: 'http://localhost:8088' } });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('access-control-allow-origin'), 'http://localhost:8088');
    assert.equal(options.headers.has('access-control-allow-credentials'), false);
    console.log('PASS real Next: no-env config/protected 503, cookie-only 401, exact CORS preflight');
  });

  const fixturePort = await listen(fixture);
  await withNext({ NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${fixturePort}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key' }, async (base) => {
    const malformed = await fetch(`${base}/bootstrap`, { headers: { authorization: 'Bearer two tokens' } });
    assert.equal(malformed.status, 401);
    assert.equal(authCalls, 0);
    const revoked = await fetch(`${base}/bootstrap`, { headers: { authorization: 'Bearer revoked.token.fixture', cookie: 'ledger_pass=a.b' } });
    assert.equal(revoked.status, 401);
    assert.equal(authCalls, 1);
    const headers = { authorization: `Bearer ${fixtureToken}`, cookie: 'ledger_pass=a.b', origin: 'http://localhost:8088' };
    const crossLedger = await fetch(`${base}/ledgers/${ledgerId}`, { headers });
    assert.equal(crossLedger.status, 403);
    assert.equal((await crossLedger.json()).code, 'ACCESS_DENIED');
    const crossWrite = await fetch(`${base}/ledgers/${ledgerId}/actions`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'markChecked', input: { expenseId: ledgerId, checked: true } }),
    });
    assert.equal(crossWrite.status, 403);
    assert.equal(mutationCalls, 0);
    assert.match(crossWrite.headers.get('cache-control'), /no-store/);
    console.log('PASS real Next: malformed/revoked Bearer 401, authenticated cross-ledger GET/POST 403, zero DB mutations');
  });
} finally {
  if (fixture.listening) await new Promise((done) => fixture.close(done));
}
