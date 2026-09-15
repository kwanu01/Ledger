/** Actual team actions and access policy; every DB/Auth operation is an isolated mock. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),ts=createRequire(path.join(root,'package.json'))('typescript');
let passed=0;
function load(file,imports) {
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,Error,console:{error(){}},
    require(key){if(!(key in imports))throw Error(`Unexpected import ${key}`);return imports[key];},fetch(){throw Error('Network disabled');}});
  return module.exports;
}
const policy=load('lib/mobile/auth-policy.ts',{});
const healthy={id:'old-member',team_id:'team',user_id:null,active:true,account_deleted_at:null};
function fixture({row={...healthy},mine=null,readError=false,mutationError=false,mutationMissing=false,passUserId,guardError=false,count=2}={}) {
  const writes=[],queries=[],issued=[];
  const db={
    async rpc(name){assert.equal(name,'assert_account_not_deleting');return{error:guardError?{message:'fixture guard failed'}:null};},
    from(table){const request={table,filters:[],columns:'',mutation:null,head:false};
      const q={select(columns,options){request.columns=columns;request.head=!!options?.head;return q;},
        eq(key,value){request.filters.push(['eq',key,value]);return q;},is(key,value){request.filters.push(['is',key,value]);return q;},
        order(){return q;},limit(){return q;},maybeSingle(){return q;},single(){return q;},
        update(value){request.mutation={type:'update',value};return q;},insert(value){request.mutation={type:'insert',value};return q;},
        then(resolve,reject){return Promise.resolve().then(()=>{
          queries.push(request);
          if(request.mutation){writes.push(request);return{data:mutationMissing?null:{id:request.mutation.type==='insert'?'new-member':row?.id??'mine'},error:mutationError?{message:'fixture mutation failed'}:null};}
          if(table==='profiles')return{data:{id:'user',display_name:'User'},error:null};
          if(table==='ledgers')return{data:{id:'book'},error:null};
          assert.equal(table,'members');
          if(readError)return{data:null,error:{message:'fixture member read failed'}};
          if(request.head)return{data:null,count,error:null};
          if(request.columns==='sort_order')return{data:{sort_order:5},error:null};
          const byUser=request.filters.some(([op,key])=>op==='eq'&&key==='user_id');
          return{data:byUser?mine:row,error:null};
        }).then(resolve,reject);}};return q;},
  };
  const access={requireUser:async()=>({id:'user',displayName:'User'}),requireLedgerAccess:async()=>({teamId:'team',memberId:'caller',userId:'user'}),
    currentPass:async()=>({teamId:'team',memberId:'old-member',...(passUserId?{userId:passUserId}:{})}),
    issuePass:async value=>issued.push(value),clearPass:async()=>{},teamForInvite:async()=> 'team',isTeamOwner:async()=>true};
  const actions=load('app/actions/teams.ts',{
    'next/cache':{revalidatePath(){}},'next/navigation':{redirect(){throw Error('Unexpected redirect');}},
    '../../lib/access.ts':access,'../../lib/auth-client.ts':{currentUser:async()=>({id:'user'})},
    '../../lib/db/client.ts':{db},'../../lib/db/images.ts':{},'../../lib/db/repo.ts':{},'../../lib/domain/money.ts':{},
    '../../lib/fail.ts':{failed:e=>({ok:false,message:e.message})},'../../lib/mobile/auth-policy.ts':policy,
  });
  return{actions,writes,queries,issued};
}
async function check(name,run){await run();passed++;console.log(`PASS ${name}`);}
const join=f=>f.actions.joinTeam({token:'valid-fixture-invite',name:'New name'});
for(const row of [{...healthy,account_deleted_at:'2026-09-15T00:00:00Z'},{...healthy,active:false},{...healthy,account_deleted_at:undefined}]) {
  await check(`stale guest row (${row.account_deleted_at??'inactive/missing'}) is never re-claimed by a valid invitation`,async()=>{
    const f=fixture({row});assert.equal((await join(f)).ok,true);
    assert.equal(f.writes.length,1);assert.equal(f.writes[0].mutation.type,'insert');assert.equal(f.issued[0].memberId,'new-member');
  });
  await check('automatic claim ignores unavailable guest identity',async()=>{const f=fixture({row});await f.actions.claimMembership();assert.equal(f.writes.length,0);});
}
await check('healthy anonymous membership is claimed only with current team/user/tombstone guards',async()=>{
  const f=fixture();assert.equal((await join(f)).ok,true);assert.equal(f.writes.length,2);
  assert.deepEqual(f.writes[0].filters,[['eq','id','old-member'],['eq','team_id','team'],['is','user_id',null],['is','account_deleted_at',null],['eq','active',true]]);
});
await check('a previous account-bound pass never claims an unrelated row',async()=>{
  const f=fixture({passUserId:'previous-account'});assert.equal((await join(f)).ok,true);
  assert.equal(f.writes[0].mutation.type,'insert');assert.equal(f.issued[0].memberId,'new-member');
  const automatic=fixture({passUserId:'previous-account'});await automatic.actions.claimMembership();assert.equal(automatic.writes.length,0);
});
for(const options of [{readError:true},{guardError:true},{mine:{id:'old-member',account_deleted_at:'2026-09-15'}}])await check('unverified schema/account/member state stops joining before writes',async()=>{
  const f=fixture(options);assert.equal((await join(f)).ok,false);assert.equal(f.writes.length,0);assert.equal(f.issued.length,0);
});
for(const options of [{mutationError:true},{mutationMissing:true}])await check('claim update failure or race does not issue a pass or report success',async()=>{
  const f=fixture(options);assert.equal((await join(f)).ok,false);assert.equal(f.writes.length,1);assert.equal(f.issued.length,0);
  const automatic=fixture(options);await assert.rejects(()=>automatic.actions.claimMembership());assert.equal(automatic.writes.length,1);
});
for(const options of [{row:{...healthy,account_deleted_at:'2026-09-15'}},{row:{...healthy,account_deleted_at:undefined}},{readError:true}])await check('owner cannot reactivate tombstoned or unverified identity',async()=>{
  const f=fixture(options);assert.equal((await f.actions.setMemberActive({ledgerId:'book',memberId:'old-member',active:true})).ok,false);assert.equal(f.writes.length,0);
});
await check('reactivation race must return an updated row',async()=>{
  const f=fixture({mutationMissing:true});assert.equal((await f.actions.setMemberActive({ledgerId:'book',memberId:'old-member',active:true})).ok,false);
  assert.ok(f.writes[0].filters.some(([op,key,value])=>op==='is'&&key==='account_deleted_at'&&value===null));
});
await check('a failed member count never deactivates a row',async()=>{
  const f=fixture({count:null});assert.equal((await f.actions.setMemberActive({ledgerId:'book',memberId:'old-member',active:false})).ok,false);assert.equal(f.writes.length,0);
});
console.log(JSON.stringify({passedScenarios:passed,liveRequests:0,source:['app/actions/teams.ts','lib/mobile/auth-policy.ts']}));
