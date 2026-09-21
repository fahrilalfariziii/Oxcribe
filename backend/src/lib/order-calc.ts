// Rumus ini harus tetap identik dengan frontend/src/mock/store.tsx agar total yang ditampilkan di UI (saat nanti disambungkan) konsisten dengan yang dihitung backend.
// PENTING: taxRate & serviceChargeRate disimpan sebagai angka PERSEN (mis. 10 = 10%), sama seperti Business.taxRate di frontend/src/mock/data.ts — BUKAN pecahan 0..1.
//
//   service  = persen subtotal | flat per transaksi  (jika serviceChargeEnabled;
//             butuh flag serviceCharge dari admin + toggle owner)
//   taxBase  = subtotal + service
//   tax      = taxBase * (taxRate / 100)               (jika taxEnabled + flag taxFees dari admin)
//   platformFee = persen subtotal | flat              (khusus self_order non-tunai, config admin)
//   total    = subtotal + service + (taxBearer === 'cafe' ? 0 : tax)
//              + (platformFeeBearer === 'cafe' ? 0 : platformFee)
//
// Catatan: tax & platformFee tetap dihitung & disimpan meski bearer = 'cafe'
// (untuk pelaporan/transparansi), hanya saja tidak ditambahkan ke total pelanggan.

export interface BusinessTaxSettings {
  taxEnabled: boolean;
  taxRate: number;
  taxLabel: string;
  taxBearer: string; // 'customer' | 'cafe'
  serviceChargeEnabled: boolean;
  serviceChargeRate: number;
  serviceChargeMode: string; // 'percent' | 'flat'
  serviceChargeFlat: number; // rupiah per transaksi (mode flat)
  platformFee: number; // rupiah, sudah dihitung oleh lib/platform-fee.ts (0 bila tak berlaku)
  platformFeeBearer: string; // 'customer' | 'cafe'
}

export interface OrderTotals {
  subtotal: number;
  serviceCharge: number;
  tax: number;
  taxLabel: string;
  taxBearer: string;
  platformFee: number;
  platformFeeBearer: string;
  total: number;
}

export function calculateOrderTotals(
  subtotal: number,
  business: BusinessTaxSettings
): OrderTotals {
  const serviceCharge = !business.serviceChargeEnabled
    ? 0
    : business.serviceChargeMode === "flat"
      ? Math.max(0, round2(business.serviceChargeFlat))
      : round2(subtotal * (Math.min(100, Math.max(0, business.serviceChargeRate)) / 100));

  const taxBase = subtotal + serviceCharge;
  const tax = business.taxEnabled ? round2(taxBase * (business.taxRate / 100)) : 0;

  const platformFee = Math.max(0, round2(business.platformFee));

  const total =
    subtotal + serviceCharge + (business.taxBearer === "cafe" ? 0 : tax)
    + (business.platformFeeBearer === "cafe" ? 0 : platformFee);

  return {
    subtotal: round2(subtotal),
    serviceCharge,
    tax,
    taxLabel: business.taxLabel,
    taxBearer: business.taxBearer,
    platformFee,
    platformFeeBearer: business.platformFeeBearer,
    total: round2(total),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
