/** Actual Storage cleanup source; no network or real account operations. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url));
const ts=createRequire(path.join(root,'package.json'))('typescript');
const prefix='11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
class MobileError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
function fixture({size=1,countOverride,referenced=false,referenceError=false,falseRemove=false,listError=false,saveError=false,invalidPath=false}={}) {
  const queue=Array.from({length:size},(_,i)=>({object_path:invalidPath?'../foreign.jpg':`${prefix}/receipt-${i}.jpg`,completed_at:null}));
  const objects=new Set(queue.map(row=>row.object_path)),removed=[],writes=[],reads=[],calls=[];
  const db={
    async rpc(name,input){assert.equal(name,'account_content_file_unreferenced');assert.ok(queue.some(row=>row.object_path===input.p_path));calls.push(input.p_path);return {data:!referenced,error:referenceError?{}:null};},
    from(table){assert.equal(table,'account_content_cleanup');let start=0,end=99,update=null;const filters=[];
      const b={select(){return b;},eq(k,v){filters.push([k,v]);return b;},order(k){assert.equal(k,'object_path');return b;},range(a,z){start=a;end=z;return b;},update(v){update=v;return b;},maybeSingle(){return b;},then(resolve,reject){return Promise.resolve().then(()=>{
        assert.ok(filters.some(([k,v])=>k==='user_id'&&v==='verified-user'));
        if(update){if(saveError)return {data:null,error:{}};const p=filters.find(([k])=>k==='object_path')?.[1];const row=queue.find(r=>r.object_path===p);assert.ok(row);row.completed_at=update.completed_at;writes.push(p);return {data:{object_path:p},error:null};}
        reads.push([start,end]);return {data:queue.slice(start,end+1),count:countOverride===undefined?queue.length:countOverride,error:null};
      }).then(resolve,reject);}};return b;},
    storage:{from(bucket){assert.equal(bucket,'expense-images');return {
      async remove(paths){assert.equal(paths.length,1);if(!falseRemove)for(const p of paths){objects.delete(p);removed.push(p);}return {data:[],error:null};},
      async list(folder,{limit,offset}){if(listError)return {data:null,error:{}};return {data:[...objects].filter(p=>p.startsWith(folder+'/')).sort().slice(offset,offset+limit).map(p=>({name:p.slice(folder.length+1),id:'object'})),error:null};},
    };}},
  };
  const imports={'server-only':{},'./client.ts':{db},'node:crypto':{randomUUID(){throw Error('Unexpected upload');}},'../mobile/http.ts':{MobileError}};
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/db/images.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,Error,Date,Set,Uint8Array,require(id){assert.ok(id in imports,id);return imports[id];},fetch(){throw Error('Network forbidden');}});
  return {run:()=>module.exports.cleanupAttributedContent('verified-user'),objects,removed,writes,reads,calls,queue};
}
let passed=0;async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
await check('all personal file pages are processed with verified account binding and retries skip confirmed files',async()=>{
  const f=fixture({size:105});await f.run();assert.equal(f.objects.size,0);assert.equal(f.writes.length,105);assert.ok(f.reads.some(([start])=>start===100));
  await f.run();assert.equal(f.removed.length,105);assert.equal(f.calls.length,105);
});
for(const option of [{referenced:true},{referenceError:true}])await check('unowned references or unverified reference queries preserve files and pending queue',async()=>{
  const f=fixture(option);await assert.rejects(f.run,e=>e.code==='CONTENT_STILL_REFERENCED');assert.equal(f.objects.size,1);assert.equal(f.removed.length,0);assert.equal(f.writes.length,0);
});
for(const option of [{falseRemove:true},{listError:true}])await check('unconfirmed Storage deletion cannot mark a personal file complete',async()=>{
  const f=fixture(option);await assert.rejects(f.run,e=>e.code==='CONTENT_CLEANUP_FAILED');assert.equal(f.writes.length,0);assert.equal(f.queue[0].completed_at,null);
});
await check('failed completion persistence remains retryable after file removal',async()=>{
  const f=fixture({saveError:true});await assert.rejects(f.run,e=>e.code==='CONTENT_CLEANUP_UNAVAILABLE');assert.equal(f.objects.size,0);assert.equal(f.queue[0].completed_at,null);
});
for(const countOverride of [null,-1,0.5,2])await check('invalid or truncated exact counts cause zero external deletes',async()=>{
  const f=fixture({countOverride});await assert.rejects(f.run,e=>e.code==='CONTENT_CLEANUP_UNAVAILABLE');assert.equal(f.calls.length,0);assert.equal(f.removed.length,0);
});
await check('malformed or foreign path is refused before a Storage call',async()=>{
  const f=fixture({invalidPath:true});await assert.rejects(f.run,e=>e.code==='CONTENT_CLEANUP_UNAVAILABLE');assert.equal(f.calls.length,0);assert.equal(f.removed.length,0);
});
console.log(JSON.stringify({passed,networkRequests:0,realStorageWrites:0}));
