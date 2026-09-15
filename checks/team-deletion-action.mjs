/** Actual server action; isolated identity/DB/Storage mocks only. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),ts=createRequire(path.join(root,'package.json'))('typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(root,'app/actions/teams.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({user='owner-a',owner='owner-a',result=true,error=null,storageError=false}={}){
  const calls=[],module={exports:{}};
  const db={from(table){assert.equal(table,'teams');const q={select(){return q;},eq(key,value){assert.equal(key,'id');assert.equal(value,'team-a');return q;},async maybeSingle(){return{data:owner?{owner_id:owner}:null,error:null};}};return q;},
    async rpc(name,args){calls.push([name,args]);assert.equal(name,'delete_team_as_owner');assert.equal(args.p_team_id,'team-a');assert.equal(args.p_expected_owner_id,user);return{data:result,error};}};
  const imports={'next/cache':{revalidatePath(){calls.push(['refresh']);}},'next/navigation':{},
    '../../lib/access.ts':{async requireLedgerAccess(){return{teamId:'team-a',memberId:'member-a',userId:user};}},
    '../../lib/auth-client.ts':{},'../../lib/db/client.ts':{db},'../../lib/db/images.ts':{async dropLedgerImages(){calls.push(['storage']);if(storageError)throw Error('fixture Storage failure');}},
    '../../lib/db/repo.ts':{},'../../lib/domain/money.ts':{},'../../lib/fail.ts':{failed:e=>({ok:false,message:e.message})},'../../lib/mobile/auth-policy.ts':{}};
  vm.runInNewContext(source,{module,exports:module.exports,Error,console:{error(){}},require(id){if(!(id in imports))throw Error('Unexpected import '+id);return imports[id];},fetch(){throw Error('Network forbidden');}});
  return{action:module.exports.deleteTeam,calls};
}
let passed=0;
async function check(label,fn){await fn();passed++;console.log('PASS '+label);}
await check('verified actor is sent to only the checked wrapper; body fields cannot override it',async()=>{
  const f=fixture();assert.equal((await f.action({ledgerId:'ledger-a',userId:'owner-b',p_expected_owner_id:'owner-b'})).ok,true);
  assert.deepEqual(f.calls.map(([name])=>name),['delete_team_as_owner','storage','refresh']);
});
for(const options of [{user:null},{owner:'owner-b'},{owner:null}])await check('guest/mismatched/missing owner cannot call deletion',async()=>{
  const f=fixture(options);assert.equal((await f.action({ledgerId:'ledger-a'})).ok,false);assert.deepEqual(f.calls,[]);
});
for(const options of [{result:false},{result:null},{result:undefined,error:{message:'missing RPC'}},{error:{message:'stale owner'}}])await check('failed or unconfirmed wrapper never falls back to unchecked RPC or reports success',async()=>{
  const f=fixture(options);assert.equal((await f.action({ledgerId:'ledger-a'})).ok,false);assert.deepEqual(f.calls.map(([name])=>name),['delete_team_as_owner']);
});
await check('legacy team Storage best-effort boundary remains explicit and separate from account cleanup',async()=>{
  const f=fixture({storageError:true});assert.equal((await f.action({ledgerId:'ledger-a'})).ok,true);assert.deepEqual(f.calls.map(([name])=>name),['delete_team_as_owner','storage','refresh']);
});
console.log(JSON.stringify({passed,realDatabaseOperations:0,realStorageOperations:0}));
