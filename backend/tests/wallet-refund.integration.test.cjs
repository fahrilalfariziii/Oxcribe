const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');
const url = process.env.PAYMENT_TEST_DATABASE_URL;

test('PostgreSQL manual refunds preserve pending and settled balances', { skip: !url }, async (t) => {
  const parsed = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.pathname === '/payment_test', 'Dedicated local payment_test database required');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const sourceRoot = path.resolve(__dirname, '../src');
  function load(relativePath) {
    const file = path.join(sourceRoot, relativePath);
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
      module, exports: module.exports, Date,
      require(id) {
        if (!id.startsWith('.')) return require(id);
        if (id === '../lib/prisma') return { prisma };
        return load(path.relative(sourceRoot, path.resolve(path.dirname(file), `${id}.ts`)));
      },
    }, { filename: file });
    return module.exports;
  }
  const service = load('services/wallet.service.ts');
  let business;
  try {
    business = await prisma.business.create({ data: { name: `Refund test ${randomUUID()}` } });
    const order = await prisma.order.create({ data: {
      businessId: business.id, orderNumber: `REFUND-${randomUUID()}`, clientOrderId: randomUUID(),
      source: 'self_order', paymentMethod: 'qris', paymentStatus: 'paid', subtotal: 100000, total: 100000,
      platformFee: 5000, mdrFee: 700,
      payments: { create: { businessId: business.id, method: 'qris', gateway: 'doku', status: 'paid', amount: 100000 } },
    }, include: { payments: true } });
    const paymentId = order.payments[0].id;
    await service.creditOrderInflow({ businessId: business.id, netAmount: 94300, orderNumber: order.orderNumber, paymentId });
    const refund = { paymentId, amount: 20000, reference: 'MANUAL-REFUND-1', proofImageUrl: 'https://example.test/refund.png', reason: 'Customer adjustment', adminId: 1 };
    await t.test('concurrent pre-settlement refund records evidence and reverses pending once', async () => {
      const result = await Promise.allSettled([service.refundPayment(refund), service.refundPayment(refund)]);
      assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
      const wallet = await prisma.merchantWallet.findUniqueOrThrow({ where: { businessId: business.id } });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      assert.equal(Number(wallet.pendingBalance), 74300);
      assert.equal(Number(wallet.availableBalance), 0);
      assert.equal(Number(payment.refundedAmount), 20000);
      assert.equal(payment.refundMetadata.length, 1);
      assert.equal(payment.refundMetadata[0].proofImageUrl, refund.proofImageUrl);
      assert.equal(await prisma.walletTransaction.count({ where: { walletId: wallet.id, type: 'PAYMENT_REFUND' } }), 1);
    });
    await t.test('actual settlement excludes prior refund, later refund reverses available only', async () => {
      await service.settlePayments({ reference: 'REFUND-STATEMENT-1', payments: [{ paymentId, gatewayFee: 600 }] });
      await service.refundPayment({ ...refund, amount: 10000, reference: 'MANUAL-REFUND-2' });
      const wallet = await prisma.merchantWallet.findUniqueOrThrow({ where: { businessId: business.id } });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      assert.equal(Number(wallet.pendingBalance), 0);
      assert.equal(Number(wallet.availableBalance), 64400);
      assert.equal(Number(payment.settledNet), 74400);
      assert.equal(Number(payment.refundedAmount), 30000);
      assert.equal(payment.refundMetadata[1].beforeSettlement, false);
      await assert.rejects(service.refundPayment({ ...refund, amount: 70000, reference: 'MANUAL-REFUND-EXCESS' }));
      const unchanged = await prisma.merchantWallet.findUniqueOrThrow({ where: { businessId: business.id } });
      assert.equal(Number(unchanged.availableBalance), 64400);
      assert.equal(await prisma.walletTransaction.count({ where: { walletId: wallet.id, type: 'PAYMENT_REFUND' } }), 2);
    });
  } finally {
    if (business) await prisma.business.delete({ where: { id: business.id } });
    await prisma.$disconnect();
  }
});
