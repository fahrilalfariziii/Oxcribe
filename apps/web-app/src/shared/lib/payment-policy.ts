export type SelfOrderPaymentMethod = 'cash' | 'qris'

export function selfOrderPaymentMethods(configured?: readonly string[] | null): SelfOrderPaymentMethod[] {
  return (configured ?? ['cash', 'qris']).filter((method): method is SelfOrderPaymentMethod => method === 'cash' || method === 'qris')
}

type CheckoutStorage = Pick<Storage, 'getItem' | 'setItem'>
const ATTEMPT_KEY = 'servopay:checkoutAttempt'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function checkoutAttemptId(storage: CheckoutStorage, payload: unknown, createId: () => string = () => crypto.randomUUID()): string {
  const fingerprint = JSON.stringify(payload)
  let attempt: { fingerprint?: unknown; clientOrderId?: unknown } | null = null
  try { attempt = JSON.parse(storage.getItem(ATTEMPT_KEY) || 'null') } catch {}
  if (attempt?.fingerprint === fingerprint && typeof attempt.clientOrderId === 'string' && UUID.test(attempt.clientOrderId)) return attempt.clientOrderId
  const clientOrderId = createId()
  storage.setItem(ATTEMPT_KEY, JSON.stringify({ fingerprint, clientOrderId }))
  return clientOrderId
}
