const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function loadDto() {
  const file = path.join(__dirname, '../src/lib/public-order.ts');
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', 'exports', source)(module, module.exports);
  return module.exports;
}
test('public order DTO retains QRIS payload but excludes reconciliation and gateway raw data', () => {
  const { toPublicOrder } = loadDto();
  const order = { id: 1, orderNumber: 'ORDER', paymentStatus: 'pending', total: 1000, mdrFee: 7, userId: 9, internalFutureField: 'secret', items: [{ id: 2, productName: 'Coffee', quantity: 1, internalFutureField: 'secret' }], table: { id: 3, tableNumber: '01', qrToken: 'secret' }, payments: [{ id: 4, method: 'qris', amount: 1000, status: 'pending', paidAt: null, refundMetadata: { proofImageUrl: 'private-proof', adminId: 8, reason: 'secret' }, refundedAmount: 100, settlementReference: 'statement-private', settledAt: 'date', gatewayFeeActual: 7, settledNet: 993, reviewReason: 'internal', internalFutureField: 'secret', gatewayData: { qrContent: 'QR-VALID', referenceNo: 'REF', expiredDate: 'expiry', chargeAttemptStatus: 'pending', chargeMessage: 'customer-safe', raw: { secret: 'raw-provider' }, lastNotification: { secret: 'notification' }, checkoutFingerprint: 'fingerprint' } }] };
  const result = toPublicOrder(order);
  assert.equal(result.payments[0].gatewayData.qrContent, 'QR-VALID');
  assert.equal(result.payments[0].gatewayData.referenceNo, 'REF');
  assert.equal(result.payments[0].gatewayData.expiredDate, 'expiry');
  assert.equal(result.payments[0].gatewayData.chargeMessage, 'customer-safe');
  for (const forbidden of ['refundMetadata', 'proofImageUrl', 'adminId', 'refundedAmount', 'settlementReference', 'settledAt', 'gatewayFeeActual', 'settledNet', 'reviewReason', 'internalFutureField', 'lastNotification', 'raw-provider', 'checkoutFingerprint', 'mdrFee', 'userId', 'qrToken']) assert.equal(JSON.stringify(result).includes(forbidden), false, forbidden);
});
test('public gateway status exposes status codes without issuer or customer notification details', () => {
  const { toPublicGatewayStatus } = loadDto();
  assert.deepEqual(toPublicGatewayStatus({ latestTransactionStatus: '00', responseCode: '2005100', raw: { proofImageUrl: 'private' }, additionalInfo: { customerName: 'Private Customer', issuerName: 'Private Bank' }, refundMetadata: { adminId: 8 } }), { latestTransactionStatus: '00', responseCode: '2005100' });
  assert.equal(toPublicGatewayStatus(null), null);
});
