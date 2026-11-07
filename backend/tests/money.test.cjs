const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const moduleRef = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/lib/order-calc.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: moduleRef, exports: moduleRef.exports });
const calculate = moduleRef.exports.calculateOrderTotals;
const base = { taxEnabled:false, taxRate:0, taxLabel:'Pajak', taxBearer:'customer', serviceChargeEnabled:false,
  serviceChargeRate:0, serviceChargeMode:'percent', serviceChargeFlat:0, platformFee:0, platformFeeBearer:'customer' };

test('order total uses whole rupiah consistent with QRIS charge', () => {
  assert.equal(calculate(100.49, base).total, 100);
  assert.equal(calculate(100.5, base).total, 101);
});

test('percentage fees produce a whole-rupiah gateway total', () => {
  assert.equal(calculate(10001, {...base, taxEnabled:true, taxRate:11, serviceChargeEnabled:true, serviceChargeRate:3}).total, 11434);
});

test('estimated gateway and platform fees leave whole-rupiah merchant credit', () => {
  const feesModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/lib/platform-fee.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { module: feesModule, exports: feesModule.exports });
  const fees = feesModule.exports;
  assert.equal(fees.estimateMdrFee(10001, 'qris').fee, 70);
  assert.equal(fees.calcPlatformFee(10001, { platformFeeEnabled:true, platformFeeMode:'percent', platformFeePercent:1, platformFeeFlat:0, platformFeeBearer:'cafe' }, {source:'self_order',paymentMethod:'qris'}).platformFee, 100);
});
