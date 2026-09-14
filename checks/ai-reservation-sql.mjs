/**
 * Execute the reservation migration in isolated, in-memory PGlite PostgreSQL.
 * Run: node checks/ai-reservation-sql.mjs [path-to-PGlite-package.json]
 * Default dependency lives in workspace work/ai-pg-checks, not the web app.
 * Verifies SQL, role permissions, month/ledger scope and sequential reservation.
 * PGlite has one connection: this does NOT verify real concurrent transactions.
 * Never connects to Supabase, loads environment secrets, or persists a database.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dependency = process.argv[2] ?? fileURLToPath(new URL('../../../work/ai-pg-checks/package.json', import.meta.url));
const { PGlite } = createRequire(path.resolve(dependency))('@electric-sql/pglite');
const pg = new PGlite();
const ledgerId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
let checks = 0;
const expect = (actual, expected) => { assert.equal(actual, expected); checks++; };
try {
  await pg.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create table public.ledgers (id uuid primary key);
    create table public.ai_extractions (
      id uuid primary key default gen_random_uuid(),
      ledger_id uuid not null references public.ledgers(id),
      expense_id uuid,
      model text not null,
      input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      cost_micro_usd bigint not null default 0,
      succeeded boolean not null default true,
      created_at timestamptz not null default now()
    );
    alter table public.ai_extractions enable row level security;
    alter table public.ai_extractions force row level security;
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update on public.ai_extractions to service_role;
    grant select on public.ledgers to service_role;
  `);
  await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260914132427_atomic_ai_usage_reservation.sql'), 'utf8'));
  const funcs = ['public.reserve_ai_usage(uuid,text,integer)', 'public.ai_usage_this_month(uuid)', 'public.ai_usage_reservation_version()'];
  for (const fn of funcs) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const { rows } = await pg.query('select has_function_privilege($1, $2, $3) as allowed', [role, fn, 'EXECUTE']);
      expect(rows[0].allowed, role === 'service_role');
    }
  }
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`set role ${role}`);
    await assert.rejects(() => pg.query('select public.reserve_ai_usage($1, $2, $3)', [ledgerId, 'mock', 3]), error => error.code === '42501');
    checks++;
    await pg.exec('reset role');
  }
  const invokers = await pg.query("select prosecdef from pg_proc where proname in ('reserve_ai_usage','ai_usage_this_month','ai_usage_reservation_version')");
  expect(invokers.rows.length, 3);
  for (const row of invokers.rows) expect(row.prosecdef, false);

  await pg.query('insert into public.ledgers(id) values ($1), ($2)', [ledgerId, otherId]);
  await pg.query(`insert into public.ai_extractions(ledger_id,model,succeeded,created_at) values
    ($1,'mock',true,now()), ($1,'mock',false,now()),
    ($1,'mock',true,(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') - interval '1 day'),
    ($2,'mock',true,now())`, [ledgerId, otherId]);
  await pg.exec('set role service_role');
  const scalar = async (sql, args = []) => (await pg.query(sql, args)).rows[0].value;
  expect(await scalar('select public.ai_usage_reservation_version() as value'), 1);
  expect(await scalar('select public.ai_usage_this_month($1) as value', [ledgerId]), 2);
  const reserved = await scalar('select public.reserve_ai_usage($1,$2,$3) as value', [ledgerId, 'mock', 3]);
  expect(typeof reserved, 'string');
  expect(await scalar('select public.ai_usage_this_month($1) as value', [ledgerId]), 3);
  expect(await scalar('select public.reserve_ai_usage($1,$2,$3) as value', [ledgerId, 'mock', 3]), null);
  expect(await scalar('select public.ai_usage_this_month($1) as value', [otherId]), 1);

  await pg.query('update public.ai_extractions set input_tokens=10, output_tokens=20, succeeded=true where id=$1', [reserved]);
  expect(await scalar('select public.ai_usage_this_month($1) as value', [ledgerId]), 3);
  await pg.query('update public.ai_extractions set succeeded=false where id=$1', [reserved]);
  expect(await scalar('select public.ai_usage_this_month($1) as value', [ledgerId]), 3);

  for (const limit of [0, -1, null]) {
    await assert.rejects(() => pg.query('select public.reserve_ai_usage($1,$2,$3)', [ledgerId, 'mock', limit]), error => error.code === '22023');
    checks++;
  }
  await assert.rejects(() => pg.query('select public.reserve_ai_usage($1,$2,$3)', [ledgerId, '', 3]), error => error.code === '22023');
  checks++;
  expect(await scalar('select public.ai_usage_this_month($1) as value', [ledgerId]), 3);
  console.log(JSON.stringify({ passedAssertions: checks, engine: 'isolated in-memory PGlite PostgreSQL', productionRequests: 0, realConcurrentTransactionsVerified: false }, null, 2));
} finally {
  await pg.close();
}
