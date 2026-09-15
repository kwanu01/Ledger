/** Actual source, isolated DB/Storage mocks. No credentials or network access. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as crypto from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const ts=createRequire(path.join(root,'package.json'))('typescript');
let passed=0;
function load(file,imports) {
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,File,FormData,ArrayBuffer,Uint8Array,Error,Date,Set,Map,
    require(id){if(!(id in imports))throw new Error('Unexpected import '+id);return imports[id];},
    fetch(){throw new Error('Network disabled');}},{filename:file});
  return module.exports;
}
const ids={ledgerId:crypto.randomUUID(),expenseId:crypto.randomUUID(),memberId:crypto.randomUUID(),userId:crypto.randomUUID()};
const bytes=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).buffer;
const oldPath=`${ids.ledgerId}/${ids.expenseId}/receipt-old.png`;
const params={...ids,kind:'receipt',bytes,contentType:'image/png'};
function fixture(failure) {
  const calls=[],operations=new Set(),files=new Set([oldPath]);let newPath;
  const operationId=crypto.randomUUID();
  const db={
    async rpc(name,args){
      calls.push([name,args]);
      if(failure===name) return {data:null,error:{message:'Fixture failure'}};
      if(name==='begin_image_upload') {operations.add(operationId);newPath=args.p_path;return {data:operationId,error:null};}
      if(name==='finish_image_upload') {if(failure==='finish-false')return {data:false,error:null};operations.delete(args.p_operation_id);return {data:true,error:null};}
      if(name==='set_expense_image')return {data:failure!=='set-false',error:null};
      throw new Error('Unexpected RPC '+name);
    },
    from(table){assert.equal(table,'expenses');const q={select(){return q;},eq(){return q;},async single(){calls.push(['read']);return {data:{ledger_id:ids.ledgerId,receipt_path:oldPath},error:null};}};return q;},
    storage:{from(bucket){assert.equal(bucket,'expense-images');return {
      async upload(p){calls.push(['upload',p]);files.add(p);if(failure==='upload-throw')throw new Error('Unknown upload response');return {error:failure==='upload-error'?{message:'Unknown upload result'}:null};},
      async remove(paths){calls.push(['remove',paths]);if(failure==='remove'||(failure==='remove-new'&&paths[0]===newPath)||(failure==='remove-old'&&paths[0]===oldPath))return {data:null,error:{message:'Unknown removal'}};
        if(failure==='remove-null')return {data:null,error:null};
        if(failure!=='remove-false')paths.forEach(p=>files.delete(p));return {data:paths.map(name=>({name})),error:null};},
      async list(prefix,options){
        calls.push(['list',prefix]);if(failure==='list-error')return {data:null,error:{message:'Unknown list'}};
        return {data:[...files].filter(p=>p.startsWith(prefix+'/')).map(p=>({name:p.slice(prefix.length+1),id:'fixture-id'})).sort((a,b)=>a.name.localeCompare(b.name)).slice(options.offset,options.offset+options.limit),error:null};
      },
    };}},
  };
  const images=load('lib/db/images.ts',{'server-only':{},'./client.ts':{db},'node:crypto':crypto,'../mobile/http.ts':{MobileError:class extends Error{}}});
  const actions=load('app/actions/images.ts',{'next/cache':{revalidatePath(){calls.push(['revalidate']);}},'../../lib/access.ts':{async requireLedgerAccess(){calls.push(['auth']);return {memberId:ids.memberId,userId:ids.userId};}},'../../lib/fail.ts':{failed(e){return {ok:false,message:e.message};}},'../../lib/db/images.ts':images});
  return {images,actions,calls,operations,files,get newPath(){return newPath;}};
}
function form(){const f=new FormData();f.set('ledgerId',ids.ledgerId);f.set('expenseId',ids.expenseId);f.set('kind','receipt');f.set('image',new File([bytes],'receipt.png',{type:'image/png'}));return f;}
async function check(name,action){await action();passed++;console.log('PASS '+name);}
await check('upload binds its verified member and user; confirmed upload keeps its durable operation',async()=>{
  const f=fixture(),v=await f.images.putImage(params);assert.equal(v.path,f.newPath);assert.ok(f.operations.has(v.operationId));
  assert.equal(f.calls[0][1].p_member_id,ids.memberId);assert.equal(f.calls[0][1].p_user_id,ids.userId);
  assert.deepEqual(f.calls.map(x=>x[0]),['begin_image_upload','upload']);
});
await check('reservation failure sends no Storage request',async()=>{
  const f=fixture('begin_image_upload');await assert.rejects(()=>f.images.putImage(params));assert.deepEqual(f.calls.map(x=>x[0]),['begin_image_upload']);
});
for(const failure of ['upload-error','upload-throw']) await check(failure+' retains unresolved operation',async()=>{
  const f=fixture(failure);await assert.rejects(()=>f.images.putImage(params));assert.equal(f.operations.size,1);assert.ok(!f.calls.some(x=>x[0]==='finish_image_upload'));
});
await check('successful attachment links with actor and expected-path CAS then removes old file and finishes',async()=>{
  const f=fixture();assert.equal((await f.actions.attachImage(form())).ok,true);
  assert.deepEqual(f.calls.map(x=>x[0]),['auth','read','begin_image_upload','upload','set_expense_image','remove','list','finish_image_upload','revalidate']);
  const args=f.calls.find(x=>x[0]==='set_expense_image')[1];assert.equal(args.p_expected_path,oldPath);assert.equal(args.p_user_id,ids.userId);assert.equal(args.p_member_id,ids.memberId);
  assert.equal(f.operations.size,0);assert.deepEqual([...f.files],[f.newPath]);
});
for(const failure of ['set_expense_image','set-false']) await check(failure+' compensates uploaded file before releasing operation',async()=>{
  const f=fixture(failure);assert.equal((await f.actions.attachImage(form())).ok,false);
  assert.deepEqual(f.calls.slice(-4).map(x=>x[0]),['set_expense_image','remove','list','finish_image_upload']);assert.equal(f.operations.size,0);assert.deepEqual([...f.files],[oldPath]);
});
await check('failed compensation preserves operation and never reports attachment success',async()=>{
  const f=fixture('remove-new');const original=f.images.setExpenseImage;f.images.setExpenseImage=async()=>{throw new Error('stale actor');};
  assert.equal((await f.actions.attachImage(form())).ok,false);assert.equal(f.operations.size,1);assert.ok(f.files.has(f.newPath));f.images.setExpenseImage=original;
});
for(const failure of ['remove-old','remove-false','list-error','finish_image_upload','finish-false']) await check(failure+' never releases an uncertain attachment as success',async()=>{
  const f=fixture(failure);assert.equal((await f.actions.attachImage(form())).ok,false);assert.equal(f.operations.size,1);assert.ok(!f.calls.some(x=>x[0]==='revalidate'));
});
for(const failure of ['remove','remove-null']) await check(failure+' leaves metadata linked when removal was not acknowledged',async()=>{
  const f=fixture(failure);assert.equal((await f.actions.removeImage({...ids,kind:'receipt'})).ok,false);assert.ok(!f.calls.some(x=>x[0]==='set_expense_image'));
});
await check('removal ACK precedes CAS unlinking and stale unlink is reported as failure',async()=>{
  const f=fixture('set-false');assert.equal((await f.actions.removeImage({...ids,kind:'receipt'})).ok,false);
  assert.deepEqual(f.calls.map(x=>x[0]),['auth','read','remove','list','set_expense_image']);assert.equal(f.calls.at(-1)[1].p_expected_path,oldPath);
});
console.log(JSON.stringify({passed,networkRequests:0,realStorageWrites:0}));
