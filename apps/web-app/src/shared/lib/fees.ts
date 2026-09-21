import type { Business, Order, PaymentMethod } from '../types'

const NON_CASH: PaymentMethod[] = ['qris', 'bank_transfer']

export function isPlatformFeeApplicable(source: Order['source'], paymentMethod: PaymentMethod): boolean {
  return source === 'self_order' && NON_CASH.includes(paymentMethod)
}

/** Preview platform fee di FE (cerminan backend lib/platform-fee.ts, pembulatan rupiah). */
export function calcPlatformFeePreview(
  subtotal: number,
  business: Pick<Business, 'platformFeeEnabled' | 'platformFeeMode' | 'platformFeePercent' | 'platformFeeFlat'>,
  source: Order['source'],
  paymentMethod: PaymentMethod,
): number {
  if (!business.platformFeeEnabled) return 0
  if (!isPlatformFeeApplicable(source, paymentMethod)) return 0
  if (business.platformFeeMode === 'flat') return Math.max(0, Math.round(business.platformFeeFlat))
  const pct = Math.min(100, Math.max(0, business.platformFeePercent))
  return Math.round(subtotal * (pct / 100))
}

/** Label fee untuk rincian, mis. "Biaya layanan (5%)" atau "Biaya layanan (Rp1.000)". */
export function platformFeeLabel(
  business: Pick<Business, 'platformFeeMode' | 'platformFeePercent' | 'platformFeeFlat' | 'platformFeeBearer'>,
  fmt: (n: number) => string,
): string {
  const base =
    business.platformFeeMode === 'flat'
      ? `Biaya layanan (${fmt(business.platformFeeFlat)})`
      : `Biaya layanan (${business.platformFeePercent}%)`
  return business.platformFeeBearer === 'cafe' ? `${base} (ditanggung kafe)` : base
}

// ---- Estimasi MDR DOKU (tabel estimasi; selalu berlabel "est.") ----

export const VA_FEE_INCL_VAT = 4440

export function estimateMdrPreview(gross: number, paymentMethod: PaymentMethod): { fee: number; label: string } {
  if (paymentMethod === 'qris') return { fee: Math.round(gross * 0.007), label: 'MDR QRIS 0,7% (est.)' }
  if (paymentMethod === 'bank_transfer') return { fee: gross > 0 ? VA_FEE_INCL_VAT : 0, label: 'Biaya VA (est.)' }
  return { fee: 0, label: 'Tanpa MDR' }
}

/** Pendapatan bersih estimasi owner = gross − platformFee − mdrFee. */
export function netEstimate(order: Pick<Order, 'total' | 'platformFee' | 'mdrFee'>): number {
  return order.total - order.platformFee - order.mdrFee
}
