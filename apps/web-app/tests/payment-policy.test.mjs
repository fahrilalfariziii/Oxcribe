import test from 'node:test'
import assert from 'node:assert/strict'
import { selfOrderPaymentMethods, checkoutAttemptId } from '../src/shared/lib/payment-policy.ts'

function memoryStorage() {
  const entries = new Map()
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
}

test('legacy transfer configuration cannot enable Self-Order VA', () => {
  assert.deepEqual(selfOrderPaymentMethods(['bank_transfer', 'qris', 'cash', 'other']), ['qris', 'cash'])
  assert.deepEqual(selfOrderPaymentMethods(['bank_transfer']), [])
  assert.deepEqual(selfOrderPaymentMethods([]), [])
  assert.deepEqual(selfOrderPaymentMethods(), ['cash', 'qris'])
})

test('lost checkout responses and reloads reuse the persisted UUID for identical checkout', () => {
  const storage = memoryStorage()
  const id = '240ba9b6-f207-4ef2-a1e7-98bf16942678'
  const payload = { qrToken: 'table', customerName: 'Guest', paymentMethod: 'qris', items: [{ productId: 1, quantity: 2 }] }
  assert.equal(checkoutAttemptId(storage, payload, () => id), id)
  assert.equal(checkoutAttemptId(storage, JSON.parse(JSON.stringify(payload)), () => { throw Error('must reuse') }), id)
})

test('changed checkout receives a new UUID; invalid persisted IDs are replaced', () => {
  const storage = memoryStorage()
  const first = '240ba9b6-f207-4ef2-a1e7-98bf16942678'
  const second = '240ba9b6-f207-4ef2-a1e7-98bf16942679'
  checkoutAttemptId(storage, { paymentMethod: 'qris' }, () => first)
  assert.equal(checkoutAttemptId(storage, { paymentMethod: 'cash' }, () => second), second)
  storage.setItem('servopay:checkoutAttempt', JSON.stringify({ fingerprint: '{}', clientOrderId: 'legacy-invalid' }))
  assert.equal(checkoutAttemptId(storage, {}, () => first), first)
})

test('unavailable persistence fails before a charge can be sent', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('storage blocked') } }
  assert.throws(() => checkoutAttemptId(storage, {}, () => '240ba9b6-f207-4ef2-a1e7-98bf16942678'), /storage blocked/)
})
