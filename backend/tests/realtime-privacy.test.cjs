const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ts=require('typescript');
const {EventEmitter}=require('node:events');

function realtime() {
  const module={exports:{}};
  const prisma={cafeTable:{findUnique:async()=>({id:1,businessId:7,isActive:true})},order:{findFirst:async({where})=>where.clientOrderId==='own-order'?{id:10,clientOrderId:'own-order',businessId:7,tableId:1}:null}};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/realtime.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:id=>id==='./prisma'?{prisma}:id==='./jwt'?{}:id==='./errors'?{AppError:class extends Error{static badRequest(s){return new this(s)}static notFound(s){return new this(s)}static unauthorized(s){return new this(s)}}}:require(id),console,process,setTimeout,clearTimeout,setInterval,clearInterval});
  return module.exports;
}
async function subscribe(api,query) {
  const req=new EventEmitter();Object.assign(req,{query,headers:{},socket:{setTimeout(){}}});
  const writes=[];
  const res={writeHead(){},write(s){writes.push(s)},status(){return this},json(value){writes.push(JSON.stringify(value))}};
  await api.handleStream(req,res);
  return {writes,close:()=>req.emit('close')};
}
test('table-only guest stream never discloses order UUIDs, cash or refund evidence',async()=>{
  const api=realtime(),sub=await subscribe(api,{qrToken:'table'});
  try{
    api.emitOrderPaymentUpdate(7,{clientOrderId:'other-secret-uuid',paymentStatus:'paid',payments:[{refundMetadata:[{proofImageUrl:'https://private-proof'}]}]});
    api.emitBusinessCashUpdate(7,{openingCash:12345});
    api.emitBusinessUpdated(7,{id:7,encryptedKey:'private-key-marker'});
    const text=sub.writes.join('');
    assert.doesNotMatch(text,/other-secret-uuid|private-proof|12345|private-key-marker/);
    assert.match(text,/business:updated/);
  }finally{sub.close()}
});
test('guest order status and replay are restricted to its own validated client ID',async()=>{
  const api=realtime();
  api.emitOrderPaymentUpdate(7,{clientOrderId:'another-order',paymentStatus:'paid'});
  const sub=await subscribe(api,{qrToken:'table',clientOrderId:'own-order'});
  try{
    api.emitOrderPaymentUpdate(7,{clientOrderId:'own-order',status:'diterima',paymentStatus:'paid',payments:[{refundMetadata:'secret-finance-evidence'}]});
    const text=sub.writes.join('');
    assert.match(text,/own-order/);assert.match(text,/paid/);
    assert.doesNotMatch(text,/another-order|secret-finance-evidence/);
  }finally{sub.close()}
});
