// Platform fee self-order non-tunai + estimasi MDR DOKU.
//
// Konteks (keputusan produk):
// - Harga menu diasumsikan sudah include pajak/service -> basis fee = SUBTOTAL.
// - Fee HANYA untuk source self_order dengan metode non-tunai (qris/bank_transfer).
//   Cash & manual order (source pos) selalu 0.
// - Bearer mengikuti pola taxBearer: customer = fee di atas total pelanggan;
//   cafe = total pelanggan tetap, fee mengurangi pendapatan owner.
// - MDR DOKU TIDAK punya API fee aktual -> pakai tabel estimasi:
//   QRIS 0,7% (inklusif PPN, regulasi BI), VA bank Rp4.000 + PPN 11% = Rp4.440,
//   cash Rp0. Selalu tampilkan label "estimasi" di UI.

export type PlatformFeeMode = "percent" | "flat";
export type FeeBearer = "customer" | "cafe";

export interface PlatformFeeConfig {
  platformFeeEnabled: boolean;
  platformFeeMode: string; // "percent" | "flat"
  platformFeePercent: number;
  platformFeeFlat: number;
  platformFeeBearer: string; // "customer" | "cafe"
}

export interface PlatformFeeResult {
  platformFee: number;
  platformFeeBearer: FeeBearer;
}

const NON_CASH = new Set(["qris", "bank_transfer", "ewallet"]);

/** True bila order ini dikenakan platform fee (self-order + non-tunai). */
export function isPlatformFeeApplicable(source: string, paymentMethod: string): boolean {
  return source === "self_order" && NON_CASH.has(paymentMethod);
}

/**
 * Hitung platform fee dari subtotal. Return 0 bila tidak applicable/disabled.
 * Nilai persen dibatasi 0..100, flat >= 0 (defensif bila data DB aneh).
 */
export function calcPlatformFee(
  subtotal: number,
  business: PlatformFeeConfig,
  opts: { source: string; paymentMethod: string }
): PlatformFeeResult {
  const bearer: FeeBearer = business.platformFeeBearer === "cafe" ? "cafe" : "customer";
  if (!business.platformFeeEnabled) return { platformFee: 0, platformFeeBearer: bearer };
  if (!isPlatformFeeApplicable(opts.source, opts.paymentMethod)) {
    return { platformFee: 0, platformFeeBearer: bearer };
  }
  if (business.platformFeeMode === "flat") {
    const flat = Math.max(0, round2(business.platformFeeFlat));
    return { platformFee: flat, platformFeeBearer: bearer };
  }
  const pct = Math.min(100, Math.max(0, business.platformFeePercent));
  return { platformFee: round2(subtotal * (pct / 100)), platformFeeBearer: bearer };
}

// ---- Estimasi MDR DOKU (tabel estimasi, BUKAN angka aktual settlement) ----

export interface MdrEstimate {
  fee: number;
  label: string;
  note: string;
}

// VA flat Rp4.000 belum termasuk PPN 11% -> biaya efektif Rp4.440.
const VA_FEE_INCL_VAT = 4440;

/**
 * Estimasi biaya MDR dari grossAmount yang di-charge ke DOKU.
 * QRIS = 0,7% (inklusif PPN). VA bank = flat Rp4.440. Cash/manual = 0.
 */
export function estimateMdrFee(grossAmount: number, paymentMethod: string): MdrEstimate {
  if (paymentMethod === "qris") {
    return {
      fee: round2(grossAmount * 0.007),
      label: "MDR QRIS 0,7%",
      note: "Estimasi tabel DOKU (inklusif PPN). Angka aktual mengikuti settlement.",
    };
  }
  if (paymentMethod === "bank_transfer") {
    return {
      fee: grossAmount > 0 ? VA_FEE_INCL_VAT : 0,
      label: "Biaya VA Rp4.440",
      note: "Estimasi: Rp4.000 + PPN 11% per transaksi sukses.",
    };
  }
  return { fee: 0, label: "Tanpa MDR", note: "Tunai/manual tidak lewat DOKU." };
}

export interface SettlementBreakdown {
  gross: number;
  platformFee: number;
  mdrFee: number;
  net: number;
}

/** Pendapatan bersih estimasi owner = gross - platformFee - mdrFee. */
export function buildSettlement(gross: number, platformFee: number, mdrFee: number): SettlementBreakdown {
  const net = round2(gross - platformFee - mdrFee);
  return { gross: round2(gross), platformFee: round2(platformFee), mdrFee: round2(mdrFee), net };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
