/** Real isolated PostgreSQL 17.6. Never reads connection env or accepts remote URLs. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const lab = path.resolve(root, '../ai-pg-concurrency');
const { Client } = createRequire(path.join(lab, 'package.json'))('pg');
const bin = path.join(lab, 'node_modules/@embedded-postgres/darwin-arm64/native/bin');
const exec = promisify(execFile), env = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
const runDir = await fs.mkdtemp(path.join(lab, 'account-run-'));
const dataDir = path.join(runDir, 'data');
const version = (await exec(path.join(bin, 'postgres'), ['--version'], { env })).stdout.trim();
assert.match(version, /17\.6$/);
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
assert.ok(port >= 20000);
await new Promise(resolve => socket.close(resolve));
const connections = new Set(), results = [];
let server, logFd;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(label, role) {
  const client = new Client({ host: '127.0.0.1', port, user: 'account_fixture', password: '', database: 'postgres', ssl: false,
    application_name: `account-fixture-${label}`, connectionTimeoutMillis: 3000,
    statement_timeout: 12000, query_timeout: 15000, idle_in_transaction_session_timeout: 15000 });
  await client.connect(); connections.add(client);
  if (role) await client.query(`set role ${role}`);
  return client;
}
async function close(client) { if (connections.delete(client)) await client.end(); }
const one = async (c, sql, args = []) => (await c.query(sql, args)).rows[0];
async function check(name, action) { await action(); results.push(name); console.log(`PASS ${name}`); }
async function waitLocked(control, client) {
  for (let i = 0; i < 300; i++) {
    const row = await one(control, 'select wait_event_type from pg_stat_activity where pid=$1', [client.processID]);
    if (row.wait_event_type === 'Lock') return;
    await delay(20);
  }
  throw new Error('Expected an observed independent waiting backend');
}
async function seed(c, hasSolo = true) {
  const f = Object.fromEntries(['user','other','shared','solo','member','peer','guest','alone','book','soloBook','expense','settlement','transfer','income'].map(k => [k, randomUUID()]));
  await c.query('insert into auth.users(id) values ($1),($2)', [f.user,f.other]);
  await c.query("insert into public.profiles(id,display_name) values ($1,'Fixture user'),($2,'Fixture other')", [f.user,f.other]);
  await c.query("insert into public.teams(id,owner_id,name) values ($1,$2,'Shared fixture')", [f.shared,f.other]);
  await c.query(`insert into public.members(id,team_id,user_id,display_name,sort_order,bank,account_no) values
    ($1,$4,$5,'Personal fixture name',1,'Fixture bank','fixture-account'),($2,$4,$6,'Other',2,null,null),($3,$4,null,'Guest',3,null,null)`,
    [f.member,f.peer,f.guest,f.shared,f.user,f.other]);
  await c.query("insert into public.ledgers(id,team_id,name) values ($1,$2,'Shared ledger')", [f.book,f.shared]);
  await c.query(`insert into public.expenses(id,ledger_id,spent_on,title,amount,payer_member_id,team_member_ids)
    values ($1,$2,current_date,'Shared fixture expense',3001,$3,array[$3,$4]::uuid[])`, [f.expense,f.book,f.member,f.peer]);
  await c.query(`insert into public.settlements(id,ledger_id,seq,label,snapshot,created_by)
    values ($1,$2,1,'Fixture settlement',$3,$4)`, [f.settlement,f.book,JSON.stringify({ totalAmount:3001,balances:[{memberId:f.member,totalPaid:3001,totalOwed:1501,netBalance:1500}],expenseIds:[f.expense] }),f.user]);
  await c.query('insert into public.settlement_expenses(settlement_id,expense_id) values ($1,$2)', [f.settlement,f.expense]);
  await c.query('insert into public.transfers(id,settlement_id,from_member_id,to_member_id,amount) values ($1,$2,$3,$4,1500)', [f.transfer,f.settlement,f.peer,f.member]);
  await c.query(`insert into public.incomes(id,ledger_id,received_on,title,amount,kind,member_id)
    values($1,$2,current_date,'Fixture dues',2000,'dues',$3)`, [f.income,f.book,f.member]);
  await c.query('insert into public.invites(team_id,created_by) values ($1,$2)', [f.shared,f.user]);
  if (hasSolo) {
    await c.query("insert into public.teams(id,owner_id,name) values ($1,$2,'Solo fixture')", [f.solo,f.user]);
    await c.query("insert into public.members(id,team_id,user_id,display_name,sort_order) values ($1,$2,$3,'Solo',1)", [f.alone,f.solo,f.user]);
    await c.query("insert into public.ledgers(id,team_id,name) values ($1,$2,'Solo ledger')", [f.soloBook,f.solo]);
    await c.query(`insert into public.expenses(ledger_id,spent_on,title,amount,payer_member_id,team_member_ids)
      values ($1,current_date,'Solo expense',100,$2,array[$2]::uuid[])`, [f.soloBook,f.alone]);
    await c.query(`insert into public.incomes(ledger_id,received_on,title,amount,kind,member_id)
      values($1,current_date,'Closed solo dues',100,'dues',$2)`, [f.soloBook,f.alone]);
    await c.query('update public.ledgers set closed_at=now() where id=$1', [f.soloBook]);
  }
  return f;
}
const wipe = (c,user) => one(c,'select public.wipe_account_data($1) as removed',[user]);
try {
  await exec(path.join(bin,'initdb'), ['-D',dataDir,'--username=account_fixture','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--locale=C'], { env, timeout:30000 });
  logFd = openSync(path.join(runDir,'postgres.log'),'a');
  server = spawn(path.join(bin,'postgres'), ['-D',dataDir,'-h','127.0.0.1','-p',String(port),'-k','','-c','max_connections=32','-c','shared_buffers=32MB'], { env, stdio:['ignore',logFd,logFd] });
  let control;
  for(let i=0;i<100;i++) { try { control=await connect('control'); break; } catch(e) { if(i===99)throw e; await delay(100); } }
  assert.ok(control);
  await control.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
    grant usage on schema public to anon,authenticated,service_role;
    -- Exercise explicit revokes even when hosted defaults grant broad rights.
    alter default privileges in schema public grant all on tables to service_role;`);
  const files = (await fs.readdir(path.join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort();
  const hashes = [];
  for(const file of files) {
    const sql=await fs.readFile(path.join(root,'supabase/migrations',file),'utf8');
    await control.query(sql); hashes.push({file,sha256:createHash('sha256').update(sql).digest('hex')});
  }
  await fs.writeFile(path.join(runDir,'migrations.json'),JSON.stringify(hashes,null,2));
  // Match server public-table privileges, deliberately grant no auth-schema read.
  await control.query(`do $$ declare t record; begin
    for t in select tablename from pg_tables where schemaname='public' and tablename not in
      ('account_deletions','apple_account_states','apple_authorization_grants','account_image_cleanup','image_upload_operations') loop
      execute format('grant select,insert,update,delete on public.%I to service_role',t.tablename);
    end loop; end $$;
    grant usage,select on all sequences in schema public to service_role;`);
  const service = await connect('service','service_role');
  await check('complete source migrations apply to PostgreSQL 17.6', async()=>assert.ok(files.some(f=>f.includes('permanent_account_access'))));
  await check('anonymous/authenticated cannot delete accounts or read deletion markers',async()=>{
    for(const role of ['anon','authenticated']) {
      const c=await connect(role,role);
      await assert.rejects(()=>wipe(c,randomUUID()),e=>e.code==='42501');
      for(const table of ['account_deletions','apple_account_states','apple_authorization_grants','account_image_cleanup','image_upload_operations'])
        await assert.rejects(()=>c.query(`select * from public.${table}`),e=>e.code==='42501');
      for(const sql of ["select public.reserve_apple_authorization($1,'net.teamledger.app',repeat('a',64))",
        "select public.complete_apple_authorization($1,$1,'fixture','v1.fixture')",'select public.freeze_apple_authorizations($1)'])
        await assert.rejects(()=>c.query(sql,[randomUUID()]),e=>e.code==='42501');
      await close(c);
    }
  });
  await check('atomic deletion anonymizes personal fields and preserves shared financial records',async()=>{
    const f=await seed(control);
    const before=await one(control,`select (select to_jsonb(e) from public.expenses e where id=$1) expense,
      (select snapshot from public.settlements where id=$2) snapshot,
      (select to_jsonb(t) from public.transfers t where id=$3) transfer,
      (select to_jsonb(i) from public.incomes i where id=$4) income`,[f.expense,f.settlement,f.transfer,f.income]);
    assert.equal((await wipe(service,f.user)).removed,1);
    const after=await one(control,`select (select to_jsonb(e) from public.expenses e where id=$1) expense,
      (select snapshot from public.settlements where id=$2) snapshot,
      (select to_jsonb(t) from public.transfers t where id=$3) transfer,
      (select to_jsonb(i) from public.incomes i where id=$4) income`,[f.expense,f.settlement,f.transfer,f.income]);
    assert.deepEqual(after,before);
    const m=await one(control,'select * from public.members where id=$1',[f.member]);
    assert.equal(m.display_name,'탈퇴한 팀원'); assert.equal(m.active,false); assert.equal(m.user_id,null);
    assert.equal(m.bank,null);assert.equal(m.account_no,null);assert.ok(m.account_deleted_at);
    for(const id of [f.peer,f.guest])assert.equal((await one(control,'select active from public.members where id=$1',[id])).active,true);
    assert.equal((await one(control,'select count(*)::int n from public.teams where id=$1',[f.solo])).n,0);
    assert.equal((await one(control,'select count(*)::int n from public.account_deletions where user_id=$1',[f.user])).n,1);
    assert.deepEqual((await control.query('select ledger_id,user_id from public.account_image_cleanup where user_id=$1',[f.user])).rows,[{ledger_id:f.soloBook,user_id:f.user}]);
    await assert.rejects(()=>service.query('delete from public.account_deletions where user_id=$1',[f.user]),e=>e.code==='42501');
    for(const update of ['active=true','account_deleted_at=null',`display_name='Recovered'`,`bank='New bank'`,`account_no='new-account'`,`user_id='${f.other}'`]) {
      await assert.rejects(()=>service.query(`update public.members set ${update} where id=$1`,[f.member]),e=>e.code==='23514');
    }
    await assert.rejects(()=>service.query('delete from public.members where id=$1',[f.member]),e=>e.code==='23514');
    await assert.rejects(()=>service.query("insert into public.profiles(id,display_name) values($1,'Recreated')",[f.user]),e=>e.code==='23514');
    await assert.rejects(()=>service.query("insert into public.teams(owner_id,name) values($1,'New team')",[f.user]),e=>e.code==='23514');
    assert.equal((await wipe(service,f.user)).removed,0,'retry while Auth remains is safe');
    await control.query('delete from auth.users where id=$1',[f.user]);
    assert.equal((await one(control,'select count(*)::int n from public.account_deletions where user_id=$1',[f.user])).n,0);
    assert.equal((await one(control,'select count(*)::int n from public.account_image_cleanup where user_id=$1',[f.user])).n,0);
    await assert.rejects(()=>service.query("insert into public.profiles(id,display_name) values($1,'After Auth removal')",[f.user]),e=>e.code==='23503');
    await assert.rejects(()=>service.query('update public.members set active=true where id=$1',[f.member]),e=>e.code==='23514');
  });
  for(const table of ['transfers','settlements','expenses','ledgers','teams','invites','members','profiles'])await check(`DB ${table} error rolls back every database change`,async()=>{
    const f=await seed(control);
    await control.query(`create function public.fixture_reject_change() returns trigger language plpgsql as $$begin raise exception 'fixture fail'; end$$;
      create trigger fixture_reject_change before ${table==='members'?'update':'delete'} on public.${table} for each statement execute function public.fixture_reject_change();`);
    try { await assert.rejects(()=>wipe(service,f.user),/fixture fail/); }
    finally { await control.query(`drop trigger fixture_reject_change on public.${table}; drop function public.fixture_reject_change()`); }
    assert.equal((await one(control,'select count(*)::int n from public.ledgers where id=$1',[f.soloBook])).n,1);
    assert.equal((await one(control,'select count(*)::int n from public.profiles where id=$1',[f.user])).n,1);
    assert.equal((await one(control,'select count(*)::int n from public.account_deletions where user_id=$1',[f.user])).n,0);
    assert.equal((await one(control,'select count(*)::int n from public.account_image_cleanup where user_id=$1',[f.user])).n,0);
    assert.equal((await one(control,'select active from public.members where id=$1',[f.member])).active,true);
  });
  await check('direct profile/Auth cascade also revokes retained identity',async()=>{
    const f=await seed(control,false);
    await control.query('delete from public.invites where created_by=$1',[f.user]);
    await control.query('delete from auth.users where id=$1',[f.user]);
    const row=await one(control,'select account_deleted_at,user_id,active,bank,account_no from public.members where id=$1',[f.member]);
    assert.ok(row.account_deleted_at);assert.equal(row.user_id,null);assert.equal(row.active,false);assert.equal(row.bank,null);assert.equal(row.account_no,null);
  });
  await check('concurrent membership activation is rechecked after team lock',async()=>{
    const f=await seed(control), inactive=randomUUID();
    await control.query("insert into public.members(id,team_id,user_id,display_name,sort_order,active) values($1,$2,$3,'Inactive',2,false)",[inactive,f.solo,f.other]);
    const gate=await connect('member-gate'), deleting=await connect('member-delete','service_role');
    await gate.query('begin'); await gate.query('select id from public.teams where id=$1 for update',[f.solo]);
    const pending=wipe(deleting,f.user).then(value=>({value}),error=>({error}));
    await waitLocked(control,deleting);
    await control.query('update public.members set active=true where id=$1',[inactive]);
    await gate.query('commit');const answer=await pending;assert.match(answer.error?.message??'',/소유자를 먼저/);
    assert.equal((await one(control,'select count(*)::int n from public.teams where id=$1',[f.solo])).n,1);
    assert.equal((await one(control,'select count(*)::int n from public.account_deletions where user_id=$1',[f.user])).n,0);
    await close(gate);await close(deleting);
  });
  await check('concurrent profile resurrection waits and is rejected after deletion commits',async()=>{
    const f=await seed(control), deleting=await connect('resurrection-delete','service_role'), resurrecting=await connect('resurrection-new','service_role');
    await deleting.query('begin');await wipe(deleting,f.user);
    const pending=resurrecting.query("insert into public.profiles(id,display_name) values($1,'Recreated') on conflict(id) do nothing",[f.user])
      .then(value=>({value}),error=>({error}));
    await waitLocked(control,resurrecting);await deleting.query('commit');
    assert.equal((await pending).error?.code,'23514');await close(deleting);await close(resurrecting);
  });
  await check('ownership transferred while deletion waits is not deleted under the former owner',async()=>{
    const f=await seed(control), newOwner=randomUUID();
    await control.query("insert into public.members(id,team_id,user_id,display_name,sort_order) values($1,$2,$3,'Next owner',2)",[newOwner,f.solo,f.other]);
    const changing=await connect('owner-changing','service_role'),deleting=await connect('owner-deleting','service_role');
    await changing.query('begin');await changing.query('update public.teams set owner_id=$1 where id=$2',[f.other,f.solo]);
    const pending=wipe(deleting,f.user).then(value=>({value}),error=>({error}));
    await waitLocked(control,deleting);await changing.query('commit');
    const answer=await pending;if(answer.error)throw answer.error;
    assert.equal(answer.value.removed,0);
    assert.equal((await one(control,'select owner_id from public.teams where id=$1',[f.solo])).owner_id,f.other);
    assert.equal((await one(control,'select count(*)::int n from public.ledgers where id=$1',[f.soloBook])).n,1);
    await close(changing);await close(deleting);
  });
  const reserve=(c,user,hash='a')=>one(c,"select public.reserve_apple_authorization($1,'net.teamledger.app',$2) result",[user,hash.repeat(64)]);
  const freeze=(c,user)=>one(c,'select public.freeze_apple_authorizations($1) result',[user]);
  const complete=(c,user,id)=>one(c,"select public.complete_apple_authorization($1,$2,'fixture-subject','v1.fixture-ciphertext') result",[user,id]);
  await check('Apple pending exchange, freeze, identity binding and post-freeze writes are guarded',async()=>{
    const f=await seed(control,false), grant=(await reserve(service,f.user)).result.grant;
    assert.equal((await freeze(service,f.user)).result.busy,true);
    assert.equal((await complete(service,f.other,grant.id)).result,false);
    assert.equal((await complete(service,f.user,grant.id)).result,true);
    const frozen=(await freeze(service,f.user)).result;
    assert.equal(frozen.grants.length,1);assert.equal(frozen.grants[0].state,'active');
    assert.equal((await reserve(service,f.user,'b')).result.blocked,true);
    assert.equal((await complete(service,f.user,grant.id)).result,false);
  });
  await check('lost Apple exchange becomes uncertain with no fabricated token',async()=>{
    const f=await seed(control,false),grant=(await reserve(service,f.user)).result.grant;
    await control.query("update public.apple_authorization_grants set created_at=now()-interval '3 minutes' where id=$1",[grant.id]);
    const frozen=(await freeze(service,f.user)).result;
    assert.equal(frozen.grants[0].state,'uncertain');assert.equal(frozen.grants[0].encrypted_token,null);
    assert.equal((await complete(service,f.user,grant.id)).result,false);
  });
  await check('committed deletion marker blocks Apple reserve and Auth deletion cascades private state',async()=>{
    const f=await seed(control,false);await reserve(service,f.user);
    await wipe(service,f.user);
    assert.equal((await reserve(service,f.user,'b')).result.blocked,true);
    await control.query('delete from auth.users where id=$1',[f.user]);
    for(const table of ['account_deletions','apple_account_states','apple_authorization_grants'])
      assert.equal((await one(control,`select count(*)::int n from public.${table} where user_id=$1`,[f.user])).n,0);
  });
  await check('independent Apple reserve/complete sessions cannot add tokens after DB deletion',async()=>{
    const f=await seed(control,false),grant=(await reserve(service,f.user)).result.grant;
    const deleting=await connect('apple-delete','service_role'),registering=await connect('apple-reserve','service_role'),completing=await connect('apple-complete','service_role');
    await deleting.query('begin');await wipe(deleting,f.user);
    const pendingReserve=reserve(registering,f.user,'b'),pendingComplete=complete(completing,f.user,grant.id);
    await waitLocked(control,registering);await waitLocked(control,completing);
    await deleting.query('commit');
    assert.equal((await pendingReserve).result.blocked,true);assert.equal((await pendingComplete).result,false);
    assert.equal((await one(control,"select count(*)::int n from public.apple_authorization_grants where user_id=$1 and state='active'",[f.user])).n,0);
    await close(deleting);await close(registering);await close(completing);
  });
  const upload=(c,ledger,expense,path,member,user)=>one(c,'select public.begin_image_upload($1,$2,$3,$4,$5) id',[ledger,expense,path,member,user]);
  const link=(c,f,path,user=f.user,member=f.member,expense=f.expense,expected=null)=>one(c,'select public.set_expense_image($1,$2,$3,$4,$5,$6,$7) changed',[f.book,expense,member,user,'receipt',path,expected]);
  await check('image upload leases survive ledger deletion and cannot be bypassed or expired',async()=>{
    const f=await seed(control),e=await one(control,'select id from public.expenses where ledger_id=$1',[f.soloBook]);
    const objectPath=`${f.soloBook}/${e.id}/receipt-fixture.jpg`;
    const pending=await upload(service,f.soloBook,e.id,objectPath,f.alone,f.user);
    await control.query("update public.image_upload_operations set created_at=now()-interval '3 days' where id=$1",[pending.id]);
    await wipe(service,f.user);
    assert.equal((await one(control,'select count(*)::int n from public.image_upload_operations where ledger_id=$1',[f.soloBook])).n,1);
    assert.equal((await one(control,'select count(*)::int n from public.account_image_cleanup where user_id=$1',[f.user])).n,1);
    await assert.rejects(()=>upload(service,f.soloBook,e.id,`${f.soloBook}/${e.id}/receipt-new.jpg`,f.alone,f.user),e=>e.code==='23514');
    await assert.rejects(()=>service.query('delete from public.image_upload_operations where id=$1',[pending.id]),e=>e.code==='42501');
    assert.equal((await one(service,'select public.finish_image_upload($1,$2) done',[pending.id,'wrong-path'])).done,false);
    assert.equal((await one(service,'select public.finish_image_upload($1,$2) done',[pending.id,objectPath])).done,true);
  });
  await check('an upload registered in another session is tracked when waiting deletion commits',async()=>{
    const f=await seed(control),e=await one(control,'select id from public.expenses where ledger_id=$1',[f.soloBook]);
    const uploading=await connect('upload-gate','service_role'),deleting=await connect('upload-delete','service_role');
    await uploading.query('begin');const pendingUpload=await upload(uploading,f.soloBook,e.id,`${f.soloBook}/${e.id}/item-concurrent.png`,f.alone,f.user);
    const pendingDelete=wipe(deleting,f.user).then(value=>({value}),error=>({error}));
    await waitLocked(control,deleting);await uploading.query('commit');
    const deleted=await pendingDelete;if(deleted.error)throw deleted.error;
    assert.equal((await one(control,'select count(*)::int n from public.image_upload_operations where id=$1',[pendingUpload.id])).n,1);
    assert.equal((await one(control,'select count(*)::int n from public.account_image_cleanup where ledger_id=$1',[f.soloBook])).n,1);
    await close(uploading);await close(deleting);
  });
  await check('an upload starting during deletion waits and cannot create a late untracked operation',async()=>{
    const f=await seed(control),e=await one(control,'select id from public.expenses where ledger_id=$1',[f.soloBook]);
    const deleting=await connect('late-upload-delete','service_role'),uploading=await connect('late-upload','service_role');
    await deleting.query('begin');await wipe(deleting,f.user);
    const pending=upload(uploading,f.soloBook,e.id,`${f.soloBook}/${e.id}/item-late.png`,f.alone,f.user).then(value=>({value}),error=>({error}));
    await waitLocked(control,uploading);await deleting.query('commit');assert.equal((await pending).error?.code,'23514');
    assert.equal((await one(control,'select count(*)::int n from public.image_upload_operations where ledger_id=$1',[f.soloBook])).n,0);
    await close(deleting);await close(uploading);
  });
  await check('shared ledger image writes bind the current member and user and reject missing expenses',async()=>{
    const f=await seed(control,false),p=`${f.book}/${f.expense}/receipt-shared.jpg`;
    for(const [member,user] of [[f.member,f.other],[f.member,null],[f.guest,f.user],[randomUUID(),f.user]]) {
      await assert.rejects(()=>upload(service,f.book,f.expense,p,member,user),e=>e.code==='23514');
      await assert.rejects(()=>link(service,f,p,user,member),e=>e.code==='23514');
    }
    assert.equal((await link(service,f,null,f.user,f.member,randomUUID())).changed,false);
    const operation=await upload(service,f.book,f.expense,p,f.member,f.user);
    assert.equal((await one(control,'select user_id from public.image_upload_operations where id=$1',[operation.id])).user_id,f.user);
    assert.equal((await link(service,f,p)).changed,true);
    await wipe(service,f.user);
    // Ledger survives, but neither signed-in nor stale guest use of that member can write.
    assert.equal((await one(control,'select receipt_path from public.expenses where id=$1',[f.expense])).receipt_path,p);
    for(const user of [f.user,null]) {
      await assert.rejects(()=>upload(service,f.book,f.expense,p+'x',f.member,user),e=>e.code==='23514');
      await assert.rejects(()=>link(service,f,null,user),e=>e.code==='23514');
    }
    assert.equal((await one(control,'select count(*)::int n from public.image_upload_operations where user_id=$1',[f.user])).n,1);
    // A different active member may continue to manage retained shared records.
    assert.equal((await link(service,f,null,f.other,f.peer,f.expense,p)).changed,true);
  });
  await check('an image link waiting on shared-member deletion cannot succeed after tombstoning',async()=>{
    const f=await seed(control,false),deleting=await connect('shared-image-delete','service_role'),linking=await connect('shared-image-link','service_role');
    await deleting.query('begin');await wipe(deleting,f.user);
    const result=link(linking,f,`${f.book}/${f.expense}/receipt-late.jpg`).then(value=>({value}),error=>({error}));
    await waitLocked(control,linking);await deleting.query('commit');
    assert.equal((await result).error?.code,'23514');
    assert.equal((await one(control,'select receipt_path from public.expenses where id=$1',[f.expense])).receipt_path,null);
    await close(deleting);await close(linking);
  });
  await check('concurrent image replacement and stale removal cannot overwrite a newer attachment',async()=>{
    const f=await seed(control,false),a=`${f.book}/${f.expense}/receipt-a.jpg`,b=`${f.book}/${f.expense}/receipt-b.jpg`;
    const ca=await connect('image-cas-a','service_role'),cb=await connect('image-cas-b','service_role');
    await ca.query('begin');assert.equal((await link(ca,f,a)).changed,true);
    const stale=link(cb,f,b).then(value=>({value}),error=>({error}));
    await waitLocked(control,cb);await ca.query('commit');
    const result=await stale;if(result.error)throw result.error;assert.equal(result.value.changed,false);
    assert.equal((await link(service,f,null)).changed,false);
    assert.equal((await one(control,'select receipt_path from public.expenses where id=$1',[f.expense])).receipt_path,a);
    await close(ca);await close(cb);
  });
  await check('guest upload operations are inherited on account claim and remain pending after deletion',async()=>{
    const f=await seed(control,false),p=`${f.book}/${f.expense}/receipt-guest.jpg`;
    const pending=await upload(service,f.book,f.expense,p,f.guest,null);
    assert.equal((await one(control,'select user_id from public.image_upload_operations where id=$1',[pending.id])).user_id,null);
    // This fixture user already has another membership: claim still cannot hide the guest request.
    await service.query('update public.members set user_id=$1 where id=$2',[f.user,f.guest]);
    assert.equal((await one(control,'select user_id from public.image_upload_operations where id=$1',[pending.id])).user_id,f.user);
    await wipe(service,f.user);
    assert.equal((await one(control,'select count(*)::int n from public.image_upload_operations where user_id=$1',[f.user])).n,1);
    await assert.rejects(()=>link(service,f,p,null,f.guest),e=>e.code==='23514');
  });
  await check('anonymous and authenticated callers cannot reserve or mutate image metadata',async()=>{
    for(const role of ['anon','authenticated']) {
      const c=await connect('image-'+role,role),f=await seed(control,false);
      await assert.rejects(()=>upload(c,f.book,f.expense,`${f.book}/${f.expense}/receipt-denied.jpg`,f.member,f.user),e=>e.code==='42501');
      await assert.rejects(()=>link(c,f,null),e=>e.code==='42501');
      await close(c);
    }
  });
  await check('cleanup readiness requires the transaction queue trigger',async()=>{
    assert.equal((await one(service,'select public.account_image_cleanup_ready() ready')).ready,true);
    await control.query('alter table public.ledgers disable trigger ledgers_queue_deleted_account_images');
    try { assert.equal((await one(service,'select public.account_image_cleanup_ready() ready')).ready,false); }
    finally { await control.query('alter table public.ledgers enable trigger ledgers_queue_deleted_account_images'); }
  });
} finally {
  await Promise.allSettled([...connections].map(close));
  if(server && server.exitCode===null) { server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.once('exit',resolve)),delay(15000)]);
    if(server.exitCode===null && server.signalCode===null) {server.kill('SIGKILL');await new Promise(resolve=>server.once('exit',resolve));} }
  if(logFd!==undefined)closeSync(logFd);
  const result={version,host:'127.0.0.1',port,passed:results.length,cases:results,serverStopped:!server||server.exitCode!==null||server.signalCode!==null,productionRequests:0,evidenceDirectory:runDir};
  await fs.writeFile(path.join(runDir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
