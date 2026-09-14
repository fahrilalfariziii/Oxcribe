import type { Business } from '../types'

/**
 * Cek flag fitur efektif tenant (disepakati):
 * - taxAndFees: fail-closed (hilang/undefined = OFF) agar total murni default.
 * - flag lain: fail-open (hilang/undefined = ON) agar tenant lama pra-kanon
 *   tidak tiba-tiba terkunci sebelum backfill plans.
 */
export function isFeatureOn(business: Pick<Business, 'features'> | null | undefined, flag: string): boolean {
  const flags = business?.features as Record<string, boolean> | undefined
  if (!flags) return flag === 'taxAndFees' ? false : true
  if (flag === 'taxAndFees') return flags[flag] === true
  return flags[flag] !== false
}

export function canUseTheme(business: Pick<Business, 'features'> | null | undefined): boolean {
  return isFeatureOn(business, 'themePreset') || isFeatureOn(business, 'themeCustom')
}
