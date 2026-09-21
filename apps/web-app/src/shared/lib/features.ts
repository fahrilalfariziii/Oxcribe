import type { Business } from '../types'

/**
 * Cek flag fitur efektif tenant (disepakati):
 * - serviceCharge, taxFees (+ taxAndFees legacy): fail-closed (hilang/undefined = OFF)
 *   agar total murni default.
 * - flag lain: fail-open (hilang/undefined = ON) agar tenant lama pra-kanon
 *   tidak tiba-tiba terkunci sebelum backfill plans.
 * - serviceCharge/taxFees yang belum boolean fallback ke taxAndFees (paket/override lama).
 */
const FAIL_CLOSED = new Set(['taxAndFees', 'serviceCharge', 'taxFees'])

export function isFeatureOn(business: Pick<Business, 'features'> | null | undefined, flag: string): boolean {
  const flags = business?.features as Record<string, boolean> | undefined
  if (!flags) return !FAIL_CLOSED.has(flag)
  if (flag === 'serviceCharge' || flag === 'taxFees') {
    const v = flags[flag]
    if (typeof v === 'boolean') return v
    return flags.taxAndFees === true
  }
  if (flag === 'taxAndFees') return flags[flag] === true
  return flags[flag] !== false
}

export function canUseTheme(business: Pick<Business, 'features'> | null | undefined): boolean {
  return isFeatureOn(business, 'themePreset') || isFeatureOn(business, 'themeCustom')
}
