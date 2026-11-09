const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, prisma = {}) {
  const exports = {};
  class AppError extends Error { static badRequest(m){return new this(m)} static notFound(m){return new this(m)} static conflict(m){return new this(m)} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/',file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:(id)=> id.includes('prisma')?{prisma}:id.includes('doku.service')?{resolveDokuConfig:()=>null}:id.includes('errors')?{AppError}:require(id), console,Date,setTimeout,setInterval});
  return exports;
}
test('bank inquiry never simulates verification', async()=> {
  await assert.rejects(load('services/doku-inquiry.service.ts').inquiryBankAccount({bankCode:'BCA',bankAccount:'12345'}), /manual/i);
});
test('completed payout requires processing state and evidence',async()=> {
  const tx={$queryRaw:async()=>[],payoutRequest:{findUnique:async()=>({id:1,status:'rejected',walletId:1,amount:50}),update:async()=>{throw new Error('must not mutate')} }};
  const svc=load('services/wallet.service.ts',{$transaction:fn=>fn(tx),...tx});
  await assert.rejects(svc.completePayout({payoutId:1,adminId:1,bankRefNumber:'ref',proofImageUrl:'https://proof.test/1'}),/processing|diproses/i);
  await assert.rejects(svc.completePayout({payoutId:1,adminId:1,bankRefNumber:'ref'}),/bukti|proof/i);
});
test('settlement is explicit and scheduler cannot unlock balances',()=> {
  const source=fs.readFileSync(require('node:path').join(__dirname,'../src/lib/scheduler.ts'),'utf8');
  assert.doesNotMatch(source,/settleAllPendingBalances/);
  assert.match(source,/Asia\/Jakarta/);
  assert.match(source,/scheduleKey/);
});
module.exports={load};

test('manual verification rejects a bank account changed since the evidence was reviewed', async () => {
  const tx = {
    $queryRaw: async () => [],
    merchantWallet: {
      findUnique: async () => ({id:1,businessId:1,bankCode:'014',bankAccount:'NEW-ACCOUNT',accountName:'OWNER'}),
      update: async () => ({isBankVerified:true}),
    },
    platformAuditLog: {create:async()=>({})},
  };
  const svc=load('services/wallet.service.ts',{$transaction:fn=>fn(tx)});
  await assert.rejects(svc.verifyWalletBank({businessId:1,adminId:1,bankCode:'014',bankAccount:'OLD-ACCOUNT',accountName:'OWNER',evidence:'Reviewed OLD-ACCOUNT statement'}),/berubah|rekening|cocok/i);
});

function database() {
  const wallet={id:1,businessId:1,availableBalance:100,pendingBalance:0,reservedBalance:0,minimumPayout:1,holdMinBalance:0,isBankVerified:true,bankCode:'BCA',bankAccount:'1234',accountName:'OWNER'};
  const payouts=[],ledger=[],payments=[],audits=[],locks=new Map();
  const mutate=(row,data)=>{for(const [k,v] of Object.entries(data))row[k]=v&&typeof v==='object'?'increment'in v?Number(row[k]||0)+v.increment:'decrement'in v?Number(row[k]||0)-v.decrement:v:v;return {...row}};
  const makeTx=()=>{
    const releases=[],held=new Set();
    return {releases,
      async $queryRaw(strings,...values){
        const key=strings.join('?')+values.join(',');if(held.has(key))return [];
        const prior=locks.get(key)||Promise.resolve();let release;const next=new Promise(r=>release=r);locks.set(key,next);await prior;held.add(key);releases.push(release);return [];
      },
      merchantWallet:{findUnique:async()=>({...wallet}),findUniqueOrThrow:async()=>({...wallet}),upsert:async()=>({...wallet}),update:async({data})=>mutate(wallet,data),updateMany:async({where,data})=>{if(where.reservedBalance&&wallet.reservedBalance<where.reservedBalance.gte)return{count:0};mutate(wallet,data);return{count:1}}},
      payoutRequest:{findUnique:async({where})=>{const p=payouts.find(p=>where.id?p.id===where.id:p.scheduleKey===where.scheduleKey);return p?{...p}:null},create:async({data})=>{const p={id:payouts.length+1,...data};payouts.push(p);return{...p}},update:async({where,data})=>mutate(payouts.find(p=>p.id===where.id),data)},
      payment:{findMany:async()=>payments.map(p=>({...p})),findUnique:async({where})=>{const p=payments.find(p=>p.id===where.id);return p?{...p}:null},update:async({where,data})=>mutate(payments.find(p=>p.id===where.id),data)},
      platformAuditLog:{create:async({data})=>{audits.push(data);return data}},
      walletTransaction:{findFirst:async({where})=>ledger.find(e=>e.walletId===where.walletId&&where.OR.some(o=>o.idempotencyKey?o.idempotencyKey===e.idempotencyKey:o.referenceId===e.referenceId))||null,create:async({data})=>{ledger.push(data);return data}},
    };
  };
  const prisma={merchantWallet:{upsert:async()=>({...wallet})},$transaction:async fn=>{const tx=makeTx();try{return await fn(tx)}finally{tx.releases.reverse().forEach(r=>r())}}};
  return {wallet,payouts,ledger,payments,audits,prisma};
}
test('parallel payouts cannot overspend and reserve exactly the accepted amount',async()=>{
 const db=database(),svc=load('services/wallet.service.ts',db.prisma);
 const result=await Promise.allSettled([svc.requestPayout({businessId:1,amount:80}),svc.requestPayout({businessId:1,amount:80})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(db.wallet.availableBalance,20);assert.equal(db.wallet.reservedBalance,80);assert.equal(db.ledger.length,1);
});
test('parallel rejects return reserved funds exactly once and cannot complete afterward',async()=>{
 const db=database(),svc=load('services/wallet.service.ts',db.prisma);
 const payout=await svc.requestPayout({businessId:1,amount:80});
 const input={payoutId:payout.id,adminId:1,reason:'duplicate transfer prevented'};
 const result=await Promise.allSettled([svc.rejectPayout(input),svc.rejectPayout(input)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.wallet.availableBalance,100);assert.equal(db.wallet.reservedBalance,0);
 await assert.rejects(svc.completePayout({payoutId:payout.id,adminId:1,bankRefNumber:'r',proofImageUrl:'https://proof.test/1'}),/processing/);
});
test('same schedule key and concurrent payment credit are idempotent',async()=>{
 const db=database(),svc=load('services/wallet.service.ts',db.prisma);
 const p={businessId:1,amount:30,source:'scheduled',scheduleKey:'1:2026-11-06'};
 const payouts=await Promise.all([svc.requestPayout(p),svc.requestPayout(p)]);
 assert.equal(payouts[0].id,payouts[1].id);assert.equal(db.wallet.reservedBalance,30);
 const credit={businessId:1,netAmount:90,orderNumber:'O-1',paymentId:7};
 await Promise.all([svc.creditOrderInflow(credit),svc.creditOrderInflow(credit)]);
 assert.equal(db.wallet.pendingBalance,90);assert.equal(db.ledger.filter(e=>e.type==='ORDER_INFLOW').length,1);
});
test('payment credit accepts caller transaction without opening a nested transaction',async()=>{
 const db=database(),svc=load('services/wallet.service.ts',{$transaction:()=>{throw Error('nested transaction')}});
 await db.prisma.$transaction(tx=>svc.creditOrderInflow({businessId:1,netAmount:90,orderNumber:'O-1',paymentId:7},tx));
 assert.equal(db.wallet.pendingBalance,90);
});
test('explicit settlement uses actual gateway fee and cannot settle the same payment twice',async()=>{
 const db=database(),svc=load('services/wallet.service.ts',db.prisma);
 db.payments.push({id:7,businessId:1,amount:100,gateway:'doku',method:'qris',status:'paid',settledAt:null,refundedAmount:0,order:{source:'self_order',orderNumber:'O-1',platformFee:5}});
 await svc.creditOrderInflow({businessId:1,netAmount:90,orderNumber:'O-1',paymentId:7});
 const input={reference:'BANK-STATEMENT-1',payments:[{paymentId:7,gatewayFee:2}]};
 const results=await Promise.allSettled([svc.settlePayments(input),svc.settlePayments(input)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(db.wallet.pendingBalance,0);assert.equal(db.wallet.availableBalance,193);
 assert.equal(db.payments[0].gatewayFeeActual,2);assert.equal(db.payments[0].settledNet,93);
 assert.equal(db.ledger.filter(e=>e.type==='SETTLEMENT').length,1);
});
test('unsettled manual payment cannot release wallet funds',async()=>{
 const db=database(),svc=load('services/wallet.service.ts',db.prisma);
 db.payments.push({id:7,businessId:1,amount:100,gateway:'manual',method:'qris',status:'paid',settledAt:null,refundedAmount:0,order:{source:'pos',orderNumber:'O-1',platformFee:0}});
 await assert.rejects(svc.settlePayments({reference:'BANK-1',payments:[{paymentId:7,gatewayFee:0}]}),/syarat/);
 assert.equal(db.wallet.availableBalance,100);assert.equal(db.ledger.length,0);
});
test('legacy or anomalous paid payment flagged for review cannot consume newer pending funds',async()=>{
 const db=database(),svc=load('services/wallet.service.ts',db.prisma);
 db.payments.push({id:7,businessId:1,amount:100,gateway:'doku',method:'qris',status:'paid',settledAt:null,reviewReason:'historical balance requires reconciliation',refundedAmount:0,order:{source:'self_order',orderNumber:'O-1',platformFee:0}});
 db.wallet.pendingBalance=500;
 db.ledger.push({walletId:1,type:'ORDER_INFLOW',referenceId:'O-1',amount:100});
 await assert.rejects(svc.settlePayments({reference:'BANK-1',payments:[{paymentId:7,gatewayFee:0}]}),/syarat/);
 assert.equal(db.wallet.pendingBalance,500);assert.equal(db.wallet.availableBalance,100);
});
test('owner bank submission clears verification; manual verification needs matching name and evidence',async()=>{
 const db=database(),svc=load('services/wallet.service.ts',db.prisma);
 await svc.updateWalletBankAccount(1,{bankCode:'BCA',bankAccount:'9999',accountName:'NEW OWNER',isVerified:true});
 assert.equal(db.wallet.isBankVerified,false);assert.equal(db.wallet.bankVerifiedAt,null);
 await assert.rejects(svc.verifyWalletBank({businessId:1,adminId:1,bankCode:'BCA',bankAccount:'9999',accountName:'OTHER NAME',evidence:'bank statement'}),/cocok/);
 await assert.rejects(svc.verifyWalletBank({businessId:1,adminId:1,bankCode:'BCA',bankAccount:'9999',accountName:'NEW OWNER',evidence:''}),/bukti/);
 await svc.verifyWalletBank({businessId:1,adminId:1,bankCode:'BCA',bankAccount:'9999',accountName:'NEW OWNER',evidence:'verified statement ref 123'});
 assert.equal(db.wallet.isBankVerified,true);assert.equal(db.audits[0].after.evidence,'verified statement ref 123');
});
test('manual refund reverses pending funds once, and settlement excludes the refunded amount',async()=>{
 const db=database(),svc=load('services/wallet.service.ts',db.prisma);
 db.payments.push({id:7,businessId:1,amount:100,gateway:'doku',method:'qris',status:'paid',settledAt:null,refundedAmount:0,refundMetadata:[],order:{source:'self_order',orderNumber:'O-1',platformFee:5}});
 await svc.creditOrderInflow({businessId:1,netAmount:90,orderNumber:'O-1',paymentId:7});
 const refund={paymentId:7,amount:20,reference:'REFUND-1',proofImageUrl:'https://proof.test/1',reason:'customer correction',adminId:1};
 await svc.refundPayment(refund);
 await assert.rejects(svc.refundPayment(refund),/telah digunakan/);
 assert.equal(db.wallet.pendingBalance,70);assert.equal(db.payments[0].refundedAmount,20);
 await svc.settlePayments({reference:'BANK-1',payments:[{paymentId:7,gatewayFee:2}]});
 assert.equal(db.wallet.pendingBalance,0);assert.equal(db.wallet.availableBalance,173);assert.equal(db.payments[0].settledNet,73);
 await svc.refundPayment({...refund,reference:'REFUND-2',amount:10});
 assert.equal(db.wallet.availableBalance,163);assert.equal(db.payments[0].refundedAmount,30);
 await assert.rejects(svc.refundPayment({...refund,reference:'REFUND-3',amount:70}),/cukup/);
});
