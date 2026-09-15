/** PostgreSQL 17.6 on a new loopback-only fixture. No remote URLs, credentials or Storage calls. */
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
const root=fileURLToPath(new URL('../',import.meta.url)),lab=path.resolve(root,'../ai-pg-concurrency');
const {Client}=createRequire(path.join(lab,'package.json'))('pg');
const bin=path.join(lab,'node_modules/@embedded-postgres/darwin-arm64/native/bin');
const exec=promisify(execFile),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'};
const runDir=await fs.mkdtemp(path.join(lab,'team-delete-run-')),dataDir=path.join(runDir,'data');
const version=(await exec(path.join(bin,'postgres'),['--version'],{env})).stdout.trim();assert.match(version,/17\.6$/);
const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;
assert.ok(port>=20000);await new Promise(resolve=>socket.close(resolve));
const connections=new Set(),results=[],delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let server,logFd;
async function connect(label,role){const c=new Client({host:'127.0.0.1',port,user:'team_fixture',password:'',database:'postgres',ssl:false,
  application_name:'team-fixture-'+label,connectionTimeoutMillis:3000,statement_timeout:12000,query_timeout:15000,idle_in_transaction_session_timeout:15000});
  await c.connect();connections.add(c);if(role)await c.query(`set role ${role}`);return c;}
async function close(c){if(connections.delete(c))await c.end();}
const one=async(c,sql,args=[]) => (await c.query(sql,args)).rows[0];
async function check(name,run){await run();results.push(name);console.log('PASS '+name);}
async function waitLocked(control,c){for(let i=0;i<250;i++){if((await one(control,'select wait_event_type from pg_stat_activity where pid=$1',[c.processID])).wait_event_type==='Lock')return;await delay(20);}throw Error('Expected an observed waiting backend');}
async function seed(c){const f=Object.fromEntries(['a','b','ma','mb','team','ledger','expense'].map(key=>[key,randomUUID()]));
  await c.query('insert into auth.users(id) values($1),($2)',[f.a,f.b]);
  await c.query("insert into public.profiles(id,display_name) values($1,'Owner A'),($2,'Member B')",[f.a,f.b]);
  await c.query("insert into public.teams(id,owner_id,name) values($1,$2,'Fixture team')",[f.team,f.a]);
  await c.query("insert into public.members(id,team_id,user_id,display_name,sort_order) values($1,$3,$4,'A',1),($2,$3,$5,'B',2)",[f.ma,f.mb,f.team,f.a,f.b]);
  await c.query("insert into public.ledgers(id,team_id,name) values($1,$2,'Fixture ledger')",[f.ledger,f.team]);
  await c.query("insert into public.expenses(id,ledger_id,spent_on,title,amount,payer_member_id,team_member_ids) values($1,$2,current_date,'Fixture expense',100,$3,array[$3,$4]::uuid[])",[f.expense,f.ledger,f.ma,f.mb]);
  return f;}
const remove=(c,f,actor=f.a)=>one(c,'select public.delete_team_as_owner($1,$2) deleted',[f.team,actor]);
const present=(c,f)=>one(c,'select (select owner_id from public.teams where id=$1) owner,exists(select 1 from public.expenses where id=$2) expense',[f.team,f.expense]);
try{
  await exec(path.join(bin,'initdb'),['-D',dataDir,'--username=team_fixture','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--locale=C'],{env,timeout:30000});
  logFd=openSync(path.join(runDir,'postgres.log'),'a');server=spawn(path.join(bin,'postgres'),['-D',dataDir,'-h','127.0.0.1','-p',String(port),'-k','','-c','max_connections=20'],{env,stdio:['ignore',logFd,logFd]});
  let control;for(let i=0;i<100;i++){try{control=await connect('control');break;}catch(e){if(i===99)throw e;await delay(100);}}assert.ok(control);
  await control.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema auth;create table auth.users(id uuid primary key);create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant execute on functions to service_role;`);
  const hashes=[];
  for(const file of (await fs.readdir(path.join(root,'supabase/migrations'))).filter(file=>file.endsWith('.sql')).sort()){
    const sql=await fs.readFile(path.join(root,'supabase/migrations',file),'utf8');await control.query(sql);hashes.push({file,sha256:createHash('sha256').update(sql).digest('hex')});}
  await fs.writeFile(path.join(runDir,'migrations.json'),JSON.stringify(hashes,null,2));
  const service=await connect('service','service_role');
  await check('all current migrations apply and only service role may call the checked wrapper',async()=>{
    for(const role of ['anon','authenticated','service_role']){
      const c=await connect('permission-'+role,role),f=await seed(control);
      await assert.rejects(()=>c.query('select public.delete_team($1)',[f.team]),e=>e.code==='42501');
      if(role!=='service_role')await assert.rejects(()=>remove(c,f),e=>e.code==='42501');
      assert.equal((await present(control,f)).owner,f.a);await close(c);
    }
  });
  await check('wrong actor, missing team and null identity perform no deletion',async()=>{
    const f=await seed(control);for(const actor of [f.b,null])await assert.rejects(()=>remove(service,f,actor),e=>e.code==='23514');
    await assert.rejects(()=>remove(service,{...f,team:randomUUID()}),e=>e.code==='23514');
    assert.deepEqual(await present(control,f),{owner:f.a,expense:true});
  });
  await check('verified owner deletion removes financial rows and team atomically',async()=>{
    const f=await seed(control);assert.equal((await remove(service,f)).deleted,true);assert.deepEqual(await present(control,f),{owner:null,expense:false});
    await assert.rejects(()=>remove(service,f),e=>e.code==='23514');
    assert.equal((await one(control,'select count(*)::int n from auth.users where id=any($1)',[[f.a,f.b]])).n,2);
  });
  await check('handover wins first: old owner delete waits then rejects without removing B team',async()=>{
    const f=await seed(control),transfer=await connect('transfer-first','service_role'),deleting=await connect('stale-delete','service_role');
    await transfer.query('begin');await transfer.query('update public.teams set owner_id=$1 where id=$2',[f.b,f.team]);
    const result=remove(deleting,f).then(value=>({value}),error=>({error}));await waitLocked(control,deleting);await transfer.query('commit');
    assert.equal((await result).error?.code,'23514');assert.deepEqual(await present(control,f),{owner:f.b,expense:true});await close(transfer);await close(deleting);
  });
  await check('authorized delete wins first: later handover cannot recreate or acquire a deleted team',async()=>{
    const f=await seed(control),deleting=await connect('delete-first','service_role'),transfer=await connect('late-transfer','service_role');
    await deleting.query('begin');assert.equal((await remove(deleting,f)).deleted,true);
    const changed=transfer.query('update public.teams set owner_id=$1 where id=$2 and owner_id=$3',[f.b,f.team,f.a]);
    await waitLocked(control,transfer);await deleting.query('commit');assert.equal((await changed).rowCount,0);assert.deepEqual(await present(control,f),{owner:null,expense:false});await close(deleting);await close(transfer);
  });
  await check('a late database failure rolls back earlier financial deletions',async()=>{
    const f=await seed(control);await control.query("create function public.fixture_stop_team_delete() returns trigger language plpgsql as $$begin raise exception 'fixture';end$$");
    await control.query('create trigger fixture_stop_team before delete on public.teams for each row execute function public.fixture_stop_team_delete()');
    try{await assert.rejects(()=>remove(service,f),e=>e.code==='P0001');assert.deepEqual(await present(control,f),{owner:f.a,expense:true});}
    finally{await control.query('drop trigger fixture_stop_team on public.teams');await control.query('drop function public.fixture_stop_team_delete()');}
  });
  await check('account-deletion marker blocks a stale owner action before destructive work',async()=>{
    const f=await seed(control);await control.query('insert into public.account_deletions(user_id) values($1)',[f.a]);
    await assert.rejects(()=>remove(service,f),e=>e.code==='23514');assert.deepEqual(await present(control,f),{owner:f.a,expense:true});
  });
}finally{
  for(const c of [...connections])await close(c).catch(()=>{});
  if(server){await exec(path.join(bin,'pg_ctl'),['-D',dataDir,'-m','immediate','stop'],{env,timeout:15000}).catch(()=>server.kill('SIGKILL'));}
  if(logFd!==undefined)closeSync(logFd);
}
await fs.writeFile(path.join(runDir,'result.json'),JSON.stringify({version,host:'127.0.0.1',passed:results.length,cases:results,serverStopped:true,productionRequests:0,evidenceDirectory:runDir},null,2));
console.log(JSON.stringify({passed:results.length,productionRequests:0,serverStopped:true,evidenceDirectory:runDir}));
