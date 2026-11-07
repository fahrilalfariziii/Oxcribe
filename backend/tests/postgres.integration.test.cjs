const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');
const url = process.env.PAYMENT_TEST_DATABASE_URL;

test('PostgreSQL financial invariants on disposable database', { skip: !url }, async (t) => {
  const parsed = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.pathname === '/payment_test', 'Dedicated local payment_test database required');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const cache = new Map();
  let gatewayCalls = 0;
  const sourceRoot = path.resolve(__dirname, '../src');
  function load(filename) {
    let file = path.resolve(sourceRoot, filename);
    if (!fs.existsSync(file) && file.endsWith('.ts')) file = path.join(file.slice(0, -3), 'index.ts');
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
      module, exports: module.exports, process, console, Buffer, URL, Date,
      setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal,
      require(id) {
        if (!id.startsWith('.')) return require(id);
        const target = path.resolve(path.dirname(file), `${id}.ts`);
        if (target === path.join(sourceRoot, 'lib/prisma.ts')) return { prisma };
        if (target === path.join(sourceRoot, 'lib/realtime.ts')) return new Proxy({}, { get: () => () => {} });
        if (target === path.join(sourceRoot, 'services/doku.service.ts')) return {
          ...load('services/doku.service.ts'),
          expireDokuQris: async () => true,
          createDokuChargeForMethod: async (input) => {
            gatewayCalls++;
            await new Promise(resolve => setTimeout(resolve, 20));
            return { partnerReferenceNo:input.invoiceId,orderNumber:input.orderNumber,grossAmount:String(input.grossAmount),qrContent:'MOCK-QR-NOT-FOR-PAYMENT',referenceNo:'MOCK-REFERENCE',raw:{} };
          },
          getDokuQrisStatus: async () => null,
        };
        return load(path.relative(sourceRoot, target));
      },
    }, { filename: file });
    return module.exports;
  }
  const wallet = load('services/wallet.service.ts');
  const orders = load('services/order.service.ts');
  const lifecycle = load('services/payment-lifecycle.service.ts');
  const ids = [];
  const admin = await prisma.platformAdmin.create({ data: { name: 'Finance test', email: `${randomUUID()}@test.invalid`, passwordHash: 'unused', role: 'superadmin' } });
  async function business() {
    const value = await prisma.business.create({ data: { name: `Payment test ${randomUUID()}` } });
    ids.push(value.id);
    return value;
  }
  async function payment(businessId, { gateway = 'doku', source = 'self_order', method = 'qris' } = {}) {
    return prisma.order.create({ data: {
      businessId, orderNumber: `TEST-${randomUUID()}`, clientOrderId: randomUUID(), source,
      paymentMethod: method, subtotal: 100000, total: 100000, mdrFee: gateway === 'doku' ? 700 : 0,
      payments: { create: { businessId, method, status: 'pending', amount: 100000, gateway } },
    }, include: { payments: true } });
  }
  try {
    await t.test('parallel payment confirmation credits the ledger exactly once', async () => {
      const b = await business(), order = await payment(b.id);
      await Promise.all(Array.from({ length: 8 }, () => orders.markOrderPaid(b.id, order.id, {}, { allowNonCash: true })));
      const w = await prisma.merchantWallet.findUniqueOrThrow({ where: { businessId: b.id } });
      assert.equal(Number(w.pendingBalance), 99300);
      assert.equal(await prisma.walletTransaction.count({ where: { walletId: w.id, type: 'ORDER_INFLOW' } }), 1);
    });
    await t.test('manual POS bank transfer never creates platform credit', async () => {
      const b = await business(), order = await payment(b.id, { gateway: 'manual', source: 'pos', method: 'bank_transfer' });
      await orders.markOrderPaid(b.id, order.id, {});
      assert.equal(await prisma.merchantWallet.count({ where: { businessId: b.id } }), 0);
    });
    await t.test('ledger failure rolls back paid transition and the same payment can retry', async () => {
      const b=await business(),order=await payment(b.id);
      const original=prisma.$transaction.bind(prisma);
      prisma.$transaction=(callback,options)=>original(tx=>callback(new Proxy(tx,{get(target,key){
        if(key==='walletTransaction')return new Proxy(target.walletTransaction,{get(delegate,name){
          if(name==='create')return async()=>{throw new Error('Injected ledger write failure')};
          return delegate[name];
        }});
        return target[key];
      }})),options);
      try {
        await assert.rejects(orders.markOrderPaid(b.id,order.id,{}, {allowNonCash:true}),/Injected ledger/);
      } finally { prisma.$transaction=original; }
      assert.equal((await prisma.order.findUniqueOrThrow({where:{id:order.id}})).paymentStatus,'pending');
      assert.equal((await prisma.payment.findUniqueOrThrow({where:{id:order.payments[0].id}})).status,'pending');
      await orders.markOrderPaid(b.id,order.id,{}, {allowNonCash:true});
      const w=await prisma.merchantWallet.findUniqueOrThrow({where:{businessId:b.id}});
      assert.equal(Number(w.pendingBalance),99300);
    });
    await t.test('parallel checkout creates one attempt and stale failed notification cannot downgrade paid', async () => {
      const b=await business(), order=await payment(b.id);
      const before=gatewayCalls;
      await Promise.all(Array.from({length:5},()=>lifecycle.ensureQrisCharge(order.id)));
      assert.equal(gatewayCalls-before,1);
      const attempts=await prisma.paymentAttempt.findMany({where:{paymentId:order.payments[0].id}});
      assert.equal(attempts.length,1);
      const raw={originalPartnerReferenceNo:attempts[0].partnerReferenceNo,latestTransactionStatus:'00',amount:{value:'100000.00',currency:'IDR'}};
      await Promise.all([lifecycle.applyQrisStatus(attempts[0].id,raw),lifecycle.applyQrisStatus(attempts[0].id,raw)]);
      await lifecycle.applyQrisStatus(attempts[0].id,{...raw,latestTransactionStatus:'06'});
      assert.equal((await prisma.order.findUniqueOrThrow({where:{id:order.id}})).paymentStatus,'paid');
      const w=await prisma.merchantWallet.findUniqueOrThrow({where:{businessId:b.id}});
      assert.equal(Number(w.pendingBalance),99300);
      assert.equal(await prisma.walletTransaction.count({where:{walletId:w.id,type:'ORDER_INFLOW'}}),1);
    });
    await t.test('late payment after cancellation is held for review without platform credit', async () => {
      const b=await business(),order=await payment(b.id);
      await lifecycle.ensureQrisCharge(order.id);
      await orders.cancelOrder(b.id,order.id);
      const attempt=await prisma.paymentAttempt.findFirstOrThrow({where:{paymentId:order.payments[0].id}});
      await lifecycle.applyQrisStatus(attempt.id,{originalPartnerReferenceNo:attempt.partnerReferenceNo,latestTransactionStatus:'00',amount:{value:'100000.00',currency:'IDR'}});
      const pay=await prisma.payment.findUniqueOrThrow({where:{id:order.payments[0].id}});
      assert.ok(pay.reviewReason);
      assert.equal((await prisma.order.findUniqueOrThrow({where:{id:order.id}})).status,'batal');
      assert.equal(await prisma.merchantWallet.count({where:{businessId:b.id}}),0);
    });
    await t.test('parallel payouts cannot overspend and parallel rejection releases once', async () => {
      const b = await business();
      await prisma.merchantWallet.create({ data: { businessId: b.id, availableBalance: 100000, minimumPayout: 10000,
        bankCode: '014', bankAccount: '12345678', accountName: 'TEST', isBankVerified: true } });
      const results = await Promise.allSettled([wallet.requestPayout({ businessId: b.id, amount: 70000 }), wallet.requestPayout({ businessId: b.id, amount: 70000 })]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const payout = results.find(r => r.status === 'fulfilled').value;
      const before = await prisma.merchantWallet.findUniqueOrThrow({ where: { businessId: b.id } });
      assert.equal(Number(before.availableBalance), 30000);
      assert.equal(Number(before.reservedBalance), 70000);
      const rejections = await Promise.allSettled([wallet.rejectPayout({ payoutId: payout.id, adminId: admin.id, reason: 'test' }), wallet.rejectPayout({ payoutId: payout.id, adminId: admin.id, reason: 'test' })]);
      assert.equal(rejections.filter(r => r.status === 'fulfilled').length, 1);
      const after = await prisma.merchantWallet.findUniqueOrThrow({ where: { businessId: b.id } });
      assert.equal(Number(after.availableBalance), 100000);
      assert.equal(Number(after.reservedBalance), 0);
      await assert.rejects(wallet.completePayout({ payoutId: payout.id, adminId: admin.id, bankRefNumber: 'test', proofImageUrl: 'https://example.test/proof.png' }));
    });
    await t.test('concurrent reconciliation settles once using actual gateway fee', async () => {
      const b = await business(), order = await payment(b.id);
      await orders.markOrderPaid(b.id, order.id, {}, { allowNonCash: true });
      const input = { reference: 'STATEMENT-TEST', payments: [{ paymentId: order.payments[0].id, gatewayFee: 600 }] };
      const results = await Promise.allSettled([wallet.settlePayments(input), wallet.settlePayments(input)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const w = await prisma.merchantWallet.findUniqueOrThrow({ where: { businessId: b.id } });
      assert.equal(Number(w.pendingBalance), 0);
      assert.equal(Number(w.availableBalance), 99400);
      const pay = await prisma.payment.findUniqueOrThrow({ where: { id: order.payments[0].id } });
      assert.equal(Number(pay.gatewayFeeActual), 600);
    });
    await t.test('HTTP boundary rejects VA self-order and support financial writes', async () => {
      const previous = { secret: process.env.JWT_SECRET, cors: process.env.CORS_ORIGIN };
      process.env.JWT_SECRET = 'payment-test-secret-not-used-outside-this-process';
      process.env.CORS_ORIGIN = 'http://127.0.0.1';
      const support = await prisma.platformAdmin.create({ data: { name:'Support test', email:`${randomUUID()}@test.invalid`, passwordHash:'unused', role:'support' } });
      const server = load('app.ts').createApp().listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        assert.equal((await fetch(`${origin}/ready`)).status, 200);
        const token = load('lib/jwt.ts').signPlatformToken({adminId:support.id,role:'support'});
        assert.equal((await fetch(`${origin}/api/platform/payments/review`,{headers:{Authorization:`Bearer ${token}`}})).status,200);
        for (const route of ['/payouts/1/process','/payouts/1/complete','/payouts/1/reject','/payouts/settlements','/wallets/1/verify-bank','/payments/1/refund']) {
          const response = await fetch(`${origin}/api/platform${route}`, { method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}' });
          assert.equal(response.status,403,route);
        }
        const b=await business();
        await prisma.business.update({where:{id:b.id},data:{featureOverrides:{selfOrder:true}}});
        const table=await prisma.cafeTable.create({data:{businessId:b.id,tableNumber:'Test',qrToken:randomUUID()}});
        const response=await fetch(`${origin}/api/public/orders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qrToken:table.qrToken,customerName:'TEST',clientOrderId:randomUUID(),paymentMethod:'bank_transfer',items:[{productId:1,quantity:1}]})});
        assert.equal(response.status,400);
        assert.equal(await prisma.order.count({where:{businessId:b.id}}),0);
      } finally {
        await new Promise(resolve=>server.close(resolve));
        await prisma.platformAdmin.delete({where:{id:support.id}});
        if (previous.secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=previous.secret;
        if (previous.cors === undefined) delete process.env.CORS_ORIGIN; else process.env.CORS_ORIGIN=previous.cors;
      }
    });
  } finally {
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
    await prisma.platformAdmin.delete({ where: { id: admin.id } });
    await prisma.$disconnect();
  }
});
