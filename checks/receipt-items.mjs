/** Actual readReceiptLines with a mocked callTool. No images, keys, or network used. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const ts=createRequire(path.join(root,'package.json'))('typescript');
const usage={input:10,output:10,costUsd:0};
let response, request, passed=0;
const module={exports:{}};
const source=ts.transpileModule(fs.readFileSync(path.join(root,'lib/ai/items.ts'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
vm.runInNewContext(source,{module,exports:module.exports,process:{env:{}},
  require(id){if(id==='server-only')return {};if(id==='./usage.ts')return {ITEM_MODEL:'fixture-model'};
    if(id==='./call.ts')return {async callTool(args){request=args;return response;}};
    throw new Error('Unexpected import '+id);},
  fetch(){throw new Error('Network forbidden');},
},{filename:'lib/ai/items.ts'});
const read=module.exports.readReceiptLines;
const item=(name,amount,kind='item',qty=1)=>({name,amount,kind,qty});
async function run(lines,total=21000,extra={}) {
  response={ok:true,input:{read:'Synthetic fixture only',lines,total,currency:'KRW',...extra},usage};
  const result=await read({base64:'not-an-image-fixture',mediaType:'image/png'});
  assert.equal(result.ok,true,result.message);return result.value;
}
const names=value=>Array.from(value.lines,l=>l.name);
async function check(name,action){await action();passed++;console.log('PASS '+name);}

await check('positive OCR immediate discount is subtracted once from undiscounted products',async()=>{
  const value=await run([item('상품 A',12000),item('상품 B',10000),item('즉시할인',1000,'discount')]);
  assert.equal(value.sum,21000);assert.equal(value.lines[2].amount,-1000);assert.equal(value.balanced,true);
});
await check('already discounted item prices do not subtract included discount or benefit notice again',async()=>{
  const value=await run([item('상품 A',11000),item('상품 B',10000),item('즉시할인',1000,'included'),item('1,000원 할인받았어요',1000,'discount')]);
  assert.deepEqual(names(value),['상품 A','상품 B']);assert.equal(value.sum,21000);assert.equal(value.balanced,true);
});
await check('misclassified discount notice and order/payment summaries are excluded defensively',async()=>{
  const value=await run([item('상품 A',11000),item('상품 B',10000),item('할인 안내',1000,'discount'),
    item('주문 금액',21000),item('상품금액 합계',21000),item('총 결제금액',21000),item('부가세(포함)',1909),item('공급가액',19091)]);
  assert.equal(value.lines.length,2);assert.equal(value.balanced,true);
});
await check('individual discounts suppress their repeated discount total, without inventing a remainder',async()=>{
  const value=await run([item('상품',22000),item('매장 쿠폰',500,'discount'),item('즉시할인',500,'discount'),item('총 할인금액',1000,'discount')]);
  assert.deepEqual(names(value),['상품','매장 쿠폰','즉시할인']);assert.equal(value.sum,21000);assert.equal(value.balanced,true);
  const mismatch=await run([item('상품',22000),item('매장 쿠폰',500,'discount'),item('할인 합계',1000,'discount')]);
  assert.equal(mismatch.sum,21500);assert.equal(mismatch.total,21000);assert.equal(mismatch.balanced,false);
});
await check('a discount total is retained when it is the only independently applied discount',async()=>{
  const value=await run([item('상품',22000),item('총 할인금액',1000,'discount')]);
  assert.equal(value.lines.length,2);assert.equal(value.lines[1].amount,-1000);assert.equal(value.balanced,true);
});
await check('the same discount total repeated in another summary is only deducted once',async()=>{
  const value=await run([item('상품',22000),item('총 할인금액',1000,'discount'),item('할인 합계',-1000,'discount')]);
  assert.equal(value.lines.length,2);assert.equal(value.sum,21000);assert.equal(value.balanced,true);
});
await check('discount-set and points gift-card merchandise stay positive',async()=>{
  const value=await run([item('할인세트',12000),item('적립금 상품권',10000)],22000);
  assert.equal(value.lines[0].amount,12000);assert.equal(value.lines[1].amount,10000);assert.equal(value.sum,22000);
});
await check('only actual delivery charges and additional paid options remain',async()=>{
  const value=await run([item('상품',20000),item('실제 배달비',1000,'shared'),item('면 추가',1000),
    item('기본맛',0),item('무료 배달',0,'shared'),item('이미 포함된 옵션',2000,'included')],22000);
  assert.deepEqual(names(value),['상품','실제 배달비','면 추가']);assert.equal(value.balanced,true);
});
await check('explicit included-tax notices do not duplicate product prices',async()=>{
  const value=await run([item('상품',10000),item('부가세 포함',909,'shared'),item('VAT (included)',909,'shared'),item('부가세 안내',909,'shared')],10000);
  assert.deepEqual(names(value),['상품']);assert.equal(value.balanced,true);
});
await check('actual separately charged bare VAT and Korean VAT remain shared charges',async()=>{
  for(const name of ['부가세','VAT']) {
    const value=await run([item('상품',10000),item(name,1000,'shared')],11000);
    assert.deepEqual(names(value),['상품',name]);assert.equal(value.lines[1].kind,'shared');assert.equal(value.sum,11000);assert.equal(value.balanced,true);
  }
});
await check('future points, optional coupons and membership promotions are not present discounts',async()=>{
  const value=await run([item('상품',21000),item('적립 예정',1000,'discount'),item('다음 주문 쿠폰',2000,'discount'),
    item('멤버십 가입 시 혜택',3000,'discount'),item('할인 가능',1000,'discount'),item('혜택',2000,'information')]);
  assert.deepEqual(names(value),['상품']);assert.equal(value.balanced,true);
});
await check('uncertain adjustments are not used to force the printed total to balance',async()=>{
  const value=await run([item('상품',22000),item('할인인지 안내인지 불명',1000,'uncertain')]);
  assert.equal(value.sum,22000);assert.equal(value.total,21000);assert.equal(value.balanced,false);
});
await check('repeated real products are preserved rather than deduplicated by name and price',async()=>{
  const value=await run([item('같은 메뉴',10500),item('같은 메뉴',10500)]);
  assert.equal(value.lines.length,2);assert.equal(value.balanced,true);
});
await check('existing negative discounts stay negative and product names remain unchanged',async()=>{
  const value=await run([item('낯선 상품-특제 2개',22000,'item',2),item('쿠폰',-1000,'discount')]);
  assert.equal(value.lines[1].amount,-1000);assert.equal(value.lines[0].name,'낯선 상품-특제 2개');assert.equal(value.lines[0].qty,2);
});
await check('empty, zero and unsafe amounts cannot create billable lines',async()=>{
  const value=await run([null,item('0원 옵션',0),item('부정확',Infinity),item('큰 값',Number.MAX_SAFE_INTEGER+1),item('상품',21000)]);
  assert.deepEqual(names(value),['상품']);assert.equal(value.balanced,true);
});
await check('a receipt with no usable charge fails and preserves usage accounting',async()=>{
  response={ok:true,input:{lines:[item('0원 옵션',0),item('합계',1000)],total:1000},usage};
  const result=await read({base64:'fixture',mediaType:'image/png'});assert.equal(result.ok,false);assert.equal(result.usage,usage);
});
await check('missing or invalid printed total never reports a fabricated balance',async()=>{
  for(const total of [undefined,null,'21000',0,NaN,Infinity,-1]) {
    const value=await run([item('상품',21000)],total);
    // undefined bypasses run's default by explicitly replacing the raw total.
    if(total===undefined){response.input.total=undefined;const result=await read({base64:'fixture',mediaType:'image/png'});assert.equal(result.value.totalRead,false);assert.equal(result.value.balanced,false);continue;}
    assert.equal(value.totalRead,false);assert.equal(value.balanced,false);assert.equal(value.total,21000);
  }
});
await check('non-charge rows before the products do not consume the forty usable-line cap',async()=>{
  const value=await run([...Array.from({length:40},()=>item('안내',123,'information')),item('상품',21000)]);
  assert.deepEqual(names(value),['상품']);
});
await check('upstream failures propagate without another AI call or fabricated result',async()=>{
  response={ok:false,message:'Fixture upstream failure',usage};
  assert.equal(await read({base64:'fixture',mediaType:'image/png'}),response);
});
await check('actual tool schema and prompt distinguish copied text from chargeable lines',async()=>{
  await run([item('상품',21000)]);
  assert.equal(request.model,'fixture-model');
  const kinds=request.tool.input_schema.properties.lines.items.properties.kind.enum;
  for(const kind of ['summary','information','included','uncertain'])assert.ok(kinds.includes(kind));
  assert.ok(!request.prompt.includes('개수와 순서는 같아야'));
  assert.ok(request.prompt.includes('총 할인금액 1,000'));
});
console.log(JSON.stringify({passed,actualSource:'lib/ai/items.ts',aiRequests:0,realImagesUsed:0}));
