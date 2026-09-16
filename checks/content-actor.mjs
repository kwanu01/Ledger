/** Real actions, repository and mapper; DB/Auth are mocked and network is forbidden. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),ts=createRequire(path.join(root,'package.json'))('typescript');
function load(file,imports){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module,exports:module.exports,Error,Date,process:{env:{}},require(id){assert.ok(id in imports,id);return imports[id];},fetch(){throw Error('Network forbidden');}});return module.exports;}
const pass={memberId:'verified-member',userId:'verified-account',teamId:'team'};
const target={id:'expense',ledger_id:'book',team_member_ids:['verified-member','payer'],allocation:'all',item_lines:null,vendor:'inherited vendor',category:'inherited category',group_name:'inherited group'};
const writes=[];
const db={from(table){let mutation=null;const b={insert(data){mutation={table,data};return b;},update(data){mutation={table,data};return b;},select(){return b;},eq(){return b;},single(){return b;},then(resolve,reject){return Promise.resolve().then(()=>{if(mutation){writes.push(mutation);return {data:{id:'saved'},error:null};}return {data:target,error:null};}).then(resolve,reject);}};return b;}};
const repo=load('lib/db/repo.ts',{'server-only':{},react:{cache:f=>f},'./client.ts':{db},'./images.ts':{},'./mapping.ts':load('lib/db/mapping.ts',{}),'../domain/settlement.ts':{}});
const actions=load('app/actions/ledger.ts',{
  'next/cache':{revalidatePath(){}},'../../lib/access.ts':{requireLedgerAccess:async()=>pass},
  '../../lib/db/repo.ts':{...repo,loadLedger:async()=>({expenses:[{id:'expense',teamMemberIds:['verified-member','payer']}]}),reopenLedger:async()=>{}},
  '../../lib/domain/settlement.ts':{currentRoster:()=>['verified-member','payer']},'../../lib/domain/closing.ts':{usesFund:()=>true,collectsDues:()=>true},
  '../../lib/limits.ts':{MAX_BATCH:50},'../../lib/mobile/idempotency.ts':{},'../../lib/mobile/replay.ts':{},'../../lib/fail.ts':{failed:e=>({ok:false,message:e.message})},
});
const input={ledgerId:'book',expenseId:'expense',date:'2026-09-16',title:'Private title',amount:1000,payerId:'payer',allocation:{type:'all'},note:'Private note',
  actor:{memberId:'forged',userId:'victim'},createdBy:'forged',content_actor:{member_id:'forged'}};
let passed=0;
for(const [name,invoke,fields] of [
  ['single expense',()=>actions.recordExpense(input),['title','note']],
  ['batch expense',()=>actions.recordExpenses({ledgerId:'book',rows:[input]}),['title','note']],
  ['income',()=>actions.recordIncome({...input,kind:'other'}),['title','note']],
  ['expense edit',()=>actions.editExpenseLine(input),['title','note']],
  ['expense label edit',()=>actions.relabelExpenseLine(input),['title','note']],
  ['group rename',()=>actions.renameExpenseGroup({...input,from:'old',to:'new'}),['group_name']],
  ['correction',()=>actions.recordCorrection({...input,targetId:'expense',actualAmount:900,originalAmount:1000,reason:'Private reason'}),['adjustment_reason']],
  ['refund',()=>actions.recordRefund({...input,targetId:'expense',refundedAmount:100,reason:'Private reason'}),['adjustment_reason']],
]){
  writes.length=0;const result=await invoke();assert.equal(result.ok,true,`${name}: ${result.message}`);assert.equal(writes.length,1);
  const actor=writes[0].data.content_actor;assert.equal(actor.member_id,pass.memberId);assert.equal(actor.user_id,pass.userId);
  for(const field of fields)assert.ok(actor.fields.includes(field));
  assert.ok(!actor.fields.includes('receipt_path'),'copied paths must not become uploader proof');
  if(name==='correction'||name==='refund'){assert.ok(!actor.fields.includes('vendor'));assert.ok(!actor.fields.includes('title'),'generated adjustment titles are copied content, not authorship');assert.equal(writes[0].data.created_by_member_id,pass.memberId);}
  passed++;console.log('PASS '+name+' uses only the verified pass and explicit field ownership');
}
console.log(JSON.stringify({passed,networkRequests:0,realDatabaseWrites:0}));
