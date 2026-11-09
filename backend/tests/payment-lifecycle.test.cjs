const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', source)((name) => name in mocks ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
test('refunded and not-found QRIS require review rather than failed', () => {
  const doku = load('services/doku.service.ts');
  assert.equal(doku.normalizeDokuStatus({ latestTransactionStatus: '04' }), 'review');
  assert.equal(doku.normalizeDokuStatus({ latestTransactionStatus: '07' }), null);
});
test('manual bank transfers have no virtual-account gateway estimate', () => {
  const fees = load('lib/platform-fee.ts');
  assert.equal(fees.estimateMdrFee(100000, 'bank_transfer').fee, 0);
  assert.equal(fees.estimateMdrFee(10001, 'qris').fee, 70);
});
test('self-order rejects bank transfer before querying database', async () => {
  const service = load('services/order.service.ts', {
    '@prisma/client': { Prisma: {} }, '../lib/prisma': { prisma: { order: { findUnique: async () => ({ id: 1 }) } } },
    '../lib/errors': { AppError: { badRequest: (s) => new Error(s) } },
    '../lib/order-calc': {}, '../lib/platform-fee': {}, '../lib/feature-gate': {}, './order-number.service': {}, './doku.service': {}, './wallet.service': {}, '../lib/realtime': {},
  });
  await assert.rejects(service.createOrder({ source: 'self_order', paymentMethod: 'bank_transfer', clientOrderId: 'x' }), /tunai|QRIS/);
});
test('POS manual QRIS and bank transfer stay available without gateway MDR', async () => {
  let persisted;
  const prisma = {
    order: { findUnique: async () => null, create: async ({ data }) => { persisted = data; return { id: 1, ...data }; } },
    business: { findUnique: async () => ({ id: 2, name: 'Cafe', enabledPaymentMethods: ['cash', 'qris'] }) },
    product: { findMany: async () => [{ id: 5, name: 'Coffee', price: 1000, isAvailable: true, options: [] }] },
  };
  const service = load('services/order.service.ts', {
    '@prisma/client': { Prisma: { PrismaClientKnownRequestError: class extends Error {} } }, '../lib/prisma': { prisma },
    '../lib/errors': { AppError: { badRequest: (s) => new Error(s) } },
    '../lib/order-calc': { calculateOrderTotals: (subtotal) => ({ subtotal, total: subtotal, serviceCharge: 0, tax: 0, platformFee: 0 }) },
    '../lib/platform-fee': { calcPlatformFee: () => ({ platformFee: 0 }), estimateMdrFee: () => ({ fee: 4440 }) },
    '../lib/feature-gate': { getBusinessFeatures: async () => ({ flags: {} }), isFeatureOn: () => false, FEATURES: {} },
    './order-number.service': { nextOrderNumber: async () => 'POS-1' }, './doku.service': {}, './wallet.service': {}, '../lib/realtime': { emitNewOrder: () => {} },
  });
  for (const method of ['bank_transfer', 'qris']) {
    const result = await service.createOrder({ businessId: 2, source: 'pos', paymentMethod: method, clientOrderId: `pos-${method}`, items: [{ productId: 5, quantity: 1 }] });
    assert.equal(result.paymentMethod, method);
    assert.equal(persisted.payments.create.method, method);
    assert.equal(persisted.mdrFee, 0);
  }
});
test('checkout replay rejects a different cart under the same idempotency key', async () => {
  const existing = { id: 1, businessId: 2, tableId: 3, source: 'self_order', customerName: 'Guest', paymentMethod: 'cash', payments: [{ gatewayData: { checkoutFingerprint: 'old' } }] };
  const service = load('services/order.service.ts', { '@prisma/client': { Prisma: {} }, '../lib/prisma': { prisma: { order: { findUnique: async () => existing } } }, '../lib/errors': { AppError: { conflict: (s) => new Error(s) } }, '../lib/order-calc': {}, '../lib/platform-fee': {}, '../lib/feature-gate': {}, './order-number.service': {}, './doku.service': {}, './wallet.service': {}, '../lib/realtime': {} });
  await assert.rejects(service.createOrder({ businessId: 2, tableId: 3, source: 'self_order', customerName: 'Guest', paymentMethod: 'cash', clientOrderId: 'same', items: [{ productId: 5, quantity: 2 }] }), /Referensi/);
});
test('checkout idempotency key cannot return another business order', async () => {
  const existing = { id: 1, businessId: 99, tableId: 3, source: 'self_order', paymentMethod: 'cash', payments: [] };
  const service = load('services/order.service.ts', { '@prisma/client': { Prisma: {} }, '../lib/prisma': { prisma: { order: { findUnique: async () => existing } } }, '../lib/errors': { AppError: { conflict: (s) => new Error(s) } }, '../lib/order-calc': {}, '../lib/platform-fee': {}, '../lib/feature-gate': {}, './order-number.service': {}, './doku.service': {}, './wallet.service': {}, '../lib/realtime': {} });
  await assert.rejects(service.createOrder({ businessId: 2, tableId: 3, source: 'self_order', paymentMethod: 'cash', clientOrderId: 'same', items: [] }), /Referensi/);
});
module.exports = { load };
function lifecycle(prisma, doku = {}, order = {}) {
  return load('services/payment-lifecycle.service.ts', { '@prisma/client': { Prisma: {} }, '../lib/prisma': { prisma }, '../lib/errors': { AppError: { unauthorized: (s) => new Error(s), badRequest: (s) => new Error(s), conflict: (s) => new Error(s) } }, '../lib/realtime': { emitOrderPaymentUpdate: () => {} }, './doku.service': doku, './order.service': order });
}
test('timeout and concurrent checkout replay keep one durable charge reference', async () => {
  let attempt, requests = 0, mutex = Promise.resolve();
  const payment = { id: 2 };
  const order = { id: 1, source: 'self_order', paymentMethod: 'qris', paymentStatus: 'pending', total: 1000, payments: [payment], orderNumber: 'TEST' };
  const tx = { $queryRaw: async () => [], order: { findUnique: async () => order }, payment: { findUniqueOrThrow: async () => payment, update: async ({ data }) => Object.assign(payment, data) }, paymentAttempt: { findFirst: async () => attempt, create: async ({ data }) => (attempt = { id: 3, ...data }), updateMany: async ({ data }) => { Object.assign(attempt, data); return { count: 1 }; } } };
  const prisma = { ...tx, $transaction: (fn) => { const result = mutex.then(() => fn(tx)); mutex = result.catch(() => {}); return result; } };
  const service = lifecycle(prisma, { makeDokuInvoiceId: () => 'saved-before-http', createDokuChargeForMethod: async (input) => { assert.equal(attempt.partnerReferenceNo, input.invoiceId); requests++; throw new Error('timeout'); } });
  await Promise.all([service.ensureQrisCharge(1), service.ensureQrisCharge(1)]);
  await service.ensureQrisCharge(1);
  assert.equal(requests, 1);
  assert.equal(attempt.status, 'unknown');
  assert.equal(attempt.partnerReferenceNo, 'saved-before-http');
});
test('only verified notification payloads enter durable inbox', async () => {
  let writes = 0;
  const prisma = { paymentNotification: { upsert: async ({ create }) => { writes++; return create; } } };
  const service = lifecycle(prisma, { verifyDokuNotification: ({ signature }) => signature === 'valid' });
  await assert.rejects(service.storeDokuNotification({}, { 'x-signature': 'bad', 'x-timestamp': 'now' }), /Signature/);
  assert.equal(writes, 0);
  const stored = await service.storeDokuNotification({ partnerReferenceNo: 'saved' }, { 'x-signature': 'valid', 'x-timestamp': 'now', authorization: 'Bearer secret' });
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(stored).includes('secret'), false);
});
test('proven no-submit preflight may retry but timeout remains blocked', async () => {
  let attempts = [], calls = 0;
  const payment = { id: 2 };
  const order = { id: 1, source: 'self_order', paymentMethod: 'qris', paymentStatus: 'pending', total: 1000, payments: [payment], orderNumber: 'TEST' };
  const tx = { $queryRaw: async () => [], order: { findUnique: async () => order }, payment: { findUniqueOrThrow: async () => payment, update: async ({ data }) => Object.assign(payment, data) }, paymentAttempt: { findFirst: async () => attempts.at(-1), create: async ({ data }) => { const attempt = { id: attempts.length + 1, ...data }; attempts.push(attempt); return attempt; }, updateMany: async ({ where, data }) => { Object.assign(attempts.find((a) => a.id === where.id), data); return { count: 1 }; } } };
  const prisma = { ...tx, $transaction: async (fn) => fn(tx) };
  const service = lifecycle(prisma, { makeDokuInvoiceId: () => `ref-${attempts.length}`, createDokuChargeForMethod: async () => { calls++; return null; } });
  await service.ensureQrisCharge(1);
  await service.ensureQrisCharge(1);
  assert.equal(calls, 2);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].status, 'failed');
  assert.equal(payment.gatewayData.chargeAttemptStatus, 'not_submitted');
});
test('QRIS validation requires exact reference, rupiah amount and currency', () => {
  const service = load('services/payment-lifecycle.service.ts', { '@prisma/client': { Prisma: {} }, '../lib/prisma': {}, '../lib/errors': {}, '../lib/realtime': {}, './doku.service': {}, './order.service': {} });
  const attempt = { partnerReferenceNo: 'saved', amount: 1000 };
  assert.equal(service.matchesQrisPayment({ originalPartnerReferenceNo: 'saved', amount: { value: '1000.00', currency: 'IDR' } }, attempt), true);
  for (const raw of [{ amount: { value: 1000, currency: 'IDR' } }, { originalPartnerReferenceNo: 'other', amount: { value: 1000, currency: 'IDR' } }, { originalPartnerReferenceNo: 'saved', amount: { value: 1000, currency: 'USD' } }, { originalPartnerReferenceNo: 'saved', amount: { value: 999, currency: 'IDR' } }]) assert.equal(service.matchesQrisPayment(raw, attempt), false);
});
test('paid transition credits only DOKU and uses same transaction', async () => {
  for (const gateway of ['manual', 'doku']) {
    let credits = 0;
    const order = { id: 1, businessId: 2, paymentStatus: 'pending', status: 'diterima', paymentMethod: 'qris', total: 1000, platformFee: 0, mdrFee: 0, orderNumber: 'TEST', payments: [{ id: 3, gateway }] };
    const tx = { $queryRaw: async () => [], order: { findFirst: async () => order, updateMany: async () => { order.paymentStatus = 'paid'; return { count: 1 }; }, findUnique: async () => order }, payment: { update: async () => ({}) } };
    const service = load('services/order.service.ts', {
      '@prisma/client': { Prisma: {} }, '../lib/prisma': { prisma: { $transaction: async (fn) => fn(tx) } }, '../lib/errors': { AppError: {} }, '../lib/order-calc': {}, '../lib/platform-fee': {}, '../lib/feature-gate': {}, './order-number.service': {}, './doku.service': {},
      './wallet.service': { creditOrderInflow: async (input, client) => { assert.equal(client, tx); credits++; } }, '../lib/realtime': { emitOrderPaymentUpdate: () => {} },
    });
    await service.markOrderPaid(2, 1, {}, { allowNonCash: true });
    await service.markOrderPaid(2, 1, {}, { allowNonCash: true });
    assert.equal(credits, gateway === 'doku' ? 1 : 0);
  }
});
test('cancel and paid serialize on the order lock', async () => {
  let locked = false;
  const order = { id: 1, businessId: 2, status: 'diterima', paymentStatus: 'paid', payments: [] };
  const tx = { $queryRaw: async () => { locked = true; }, order: { findFirst: async () => { assert.equal(locked, true); return order; } } };
  const service = load('services/order.service.ts', { '@prisma/client': { Prisma: {} }, '../lib/prisma': { prisma: { $transaction: async (fn) => fn(tx) } }, '../lib/errors': { AppError: { badRequest: (s) => new Error(s) } }, '../lib/order-calc': {}, '../lib/platform-fee': {}, '../lib/feature-gate': {}, './order-number.service': {}, './doku.service': {}, './wallet.service': {}, '../lib/realtime': {} });
  await assert.rejects(service.cancelOrder(2, 1), /lunas/);
  assert.equal(locked, true);
});
test('stale failure cannot downgrade paid and late canceled success enters review', async () => {
  const doku = load('services/doku.service.ts');
  for (const state of ['paid', 'canceled']) {
    const writes = [];
    const order = { id: 1, businessId: 2, status: state === 'canceled' ? 'batal' : 'diterima', paymentStatus: state };
    const attempt = { id: 3, partnerReferenceNo: 'saved', amount: 1000, status: state, payment: { id: 2, orderId: 1, order } };
    const tx = { $queryRaw: async () => [], paymentAttempt: { findUnique: async () => attempt, findUniqueOrThrow: async () => attempt, update: async ({ data }) => writes.push(['attempt', data]) }, payment: { update: async ({ data }) => writes.push(['payment', data]) } };
    const service = lifecycle({ $transaction: async (fn) => fn(tx) }, doku, { markOrderPaid: async () => { throw new Error('Must not mark canceled or already-paid order'); } });
    await service.applyQrisStatus(3, { originalPartnerReferenceNo: 'saved', latestTransactionStatus: state === 'paid' ? '06' : '00', amount: { value: 1000, currency: 'IDR' } });
    if (state === 'paid') assert.deepEqual(writes, []);
    else { assert.equal(writes[0][1].status, 'review'); assert.match(writes[1][1].reviewReason, /Late/); }
  }
});
test('failed gateway polling advances worker scheduling so later attempts are not starved', async () => {
  let scheduled = 0;
  const prisma = { payment: { findFirst: async () => ({ id: 2 }) }, paymentAttempt: { findMany: async () => [{ id: 3, status: 'unknown', partnerReferenceNo: 'saved' }], update: async () => { scheduled++; } } };
  const service = lifecycle(prisma, { getDokuQrisStatus: async () => { throw new Error('gateway down'); } });
  await assert.rejects(service.pollQrisOrder(1), /gateway down/);
  assert.equal(scheduled, 1);
});
