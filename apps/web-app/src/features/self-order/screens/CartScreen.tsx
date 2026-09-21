import { useEffect, useState } from "react";
import type { CartItem, PaymentMethod } from "../../../shared/types";
import { formatRupiah } from "../../../shared/lib/format";
import { calcPlatformFeePreview, platformFeeLabel } from "../../../shared/lib/fees";
import { Button } from "../../../shared/components/ui";
import {IconBack, IconMinus, IconPlus,} from "../../../shared/components/icons";
import { useCafe } from "../../../mock/store";
import { normalizeTheme } from "../../../shared/types";
import { isFeatureOn } from "../../../shared/lib/features";

interface Props {
  tableNumber: string;
  cart: CartItem[];
  customerName: string;
  payMethod: PaymentMethod;
  selectedBank: string;
  onSelectBank: (bank: string) => void;
  onName: (v: string) => void;
  onPayMethod: (v: PaymentMethod) => void;
  onBack: () => void;
  onUpdateQty: (id: string, delta: number) => void;
  onCheckout: () => void;
}

const ALL_METHODS: { id: PaymentMethod; label: string; sub: string }[] = [
  { id: "cash", label: "Tunai", sub: "Bayar di Kasir" },
  { id: "qris", label: "QRIS", sub: "Dana, ShopeePay, GoPay, dll" },
  { id: "bank_transfer", label: "Transfer Bank", sub: "BCA, Mandiri, BNI, BRI" },
];

const BANKS = [
  { id: 'bca', label: 'BCA' },
  { id: 'mandiri', label: 'Mandiri' },
  { id: 'bni', label: 'BNI' },
  { id: 'bri', label: 'BRI' },
] as const

export function CartScreen({
  tableNumber,
  cart,
  customerName,
  payMethod,
  selectedBank,
  onSelectBank,
  onName,
  onPayMethod,
  onBack,
  onUpdateQty,
  onCheckout,
}: Props) {
  const { business } = useCafe()
  const theme = normalizeTheme(business.theme)
  const [error, setError] = useState(false);
  const availableMethods = ALL_METHODS.filter((m) => (business.enabledPaymentMethods ?? ['cash','qris']).includes(m.id))
  const bankCfg = (business.paymentSettings as Record<string, { allowedBanks?: string[]; bank?: string }>)?.bank_transfer
  // Saring ke 4 bank yang didukung Midtrans Core API — nilai basi (permata/cimb/dll)
  // dari pengaturan lama tidak boleh ditawarkan ke pelanggan.
  const SUPPORTED_BANK_IDS = ['bca', 'mandiri', 'bni', 'bri']
  const rawAllowed: string[] = bankCfg?.allowedBanks && bankCfg.allowedBanks.length > 0 ? bankCfg.allowedBanks : (bankCfg?.bank ? [bankCfg.bank] : SUPPORTED_BANK_IDS)
  const allowedBanks: string[] = rawAllowed.filter((b) => SUPPORTED_BANK_IDS.includes(b))
  const effectiveAllowed = allowedBanks.length > 0 ? allowedBanks : SUPPORTED_BANK_IDS
  const visibleBanks = BANKS.filter((b) => effectiveAllowed.includes(b.id))
  useEffect(() => {
    if (payMethod === 'bank_transfer' && !effectiveAllowed.includes(selectedBank) && visibleBanks.length > 0) onSelectBank(visibleBanks[0].id)
  }, [effectiveAllowed.join(','), payMethod])
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const taxFeatureOn = isFeatureOn(business, 'taxFees')
  // Service charge ikut flag granular (admin) + toggle owner.
  const svcFeatureOn = isFeatureOn(business, 'serviceCharge')
  const serviceCharge = cart.length > 0 && svcFeatureOn && business.serviceChargeEnabled
    ? (business.serviceChargeMode === 'flat'
      ? Math.max(0, Math.round(business.serviceChargeFlat))
      : Math.round(subtotal * (Math.min(100, Math.max(0, business.serviceChargeRate)) / 100)))
    : 0
  const taxBase = subtotal + serviceCharge
  const tax = cart.length > 0 && taxFeatureOn && business.taxEnabled ? Math.round(taxBase * (business.taxRate / 100)) : 0
  // Platform fee: khusus self-order non-tunai (cash & manual selalu 0).
  const platformFee = cart.length > 0 ? calcPlatformFeePreview(subtotal, business, 'self_order', payMethod) : 0
  const total = (taxFeatureOn && business.taxEnabled && business.taxBearer === 'cafe' ? subtotal + serviceCharge : subtotal + serviceCharge + tax)
    + (business.platformFeeBearer === 'cafe' ? 0 : platformFee)
  const handleCheckout = () => {
    // Validasi: Cek jika nama kosong atau hanya berisi spasi
    if (!customerName.trim()) {
      setError(true);
      return;
    }

    setError(false);
    onCheckout();
  };

  return (
    <div className="flex h-full flex-col" style={{ background: theme.pageBg }}>
      <header className="flex h-12 shrink-0 items-center justify-between px-5 shadow-sm">
        <button onClick={onBack} className="size-12" aria-label="Kembali">
          <IconBack />
        </button>
        <span className="font-display text-xl font-bold">Keranjang</span>
        <span className="text-sm">Table {tableNumber}</span>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-6 pb-48 scrollbar-hide">
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="font-display mb-3 text-xl font-semibold">
              Informasi Pemesan
            </h2>
            <div className="relative">
              <input
                className={`w-full rounded-[8px] border bg-white px-4 pb-3 pt-6 text-base outline-none transition-colors ${
                  error
                    ? "border-red-500 focus:border-red-500"
                    : "border-clay focus:border-sage"
                }`}
                value={customerName}
                onChange={(e) => {
                  if (error) setError(false);
                  onName(e.target.value);
                }}
                placeholder=" "
                required
              />
              <span className="absolute left-4 top-2 text-xs text-soil">
                Nama Pemesan
              </span>
            </div>
            <p className="mt-1 px-1 text-xs text-soil"></p>
            {error ? (
              <p className="mt-1 px-1 text-xs font-medium text-red-500">
                Nama pemesan wajib diisi sebelum memesan.
              </p>
            ) : (
              <p className="mt-1 px-1 text-xs text-soil">
                Nama ini akan dipanggil saat pesanan siap.
              </p>
            )}
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="font-display text-xl font-semibold">Pesanan Anda</h2>
            {cart.map((ci) => {
              // Detail varian dan add-ons
              const details = Object.entries(ci.options || {})
                .map(([key, value]) => {
                  if (typeof value === 'boolean' && value) return key
                  if (typeof value === 'string' && value) return value
                  return null
                }).filter(Boolean)

              return (
                <div key={ci.cartId} className="flex gap-4 rounded-[12px] bg-white p-4 shadow-sm">
                  {/* Gambar Produk */}
                  {ci.imageUrl ? (
                    <img src={ci.imageUrl} alt={ci.name} className="size-24 rounded-[8px] object-cover shrink-0"/>
                  ) : (
                    <div className="flex size-24 shrink-0 items-center justify-center rounded-[8px] bg-sand font-display text-2xl text-stone">
                      {(ci.name || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  {/* Informasi Produk (Kiri) */}
                  <div className="flex min-w-0 flex-1 flex-col justify-between">
                    <div>
                      <p className="text-sm font-bold text-ink">{ci.name}</p>

                      {details.length > 0 ? (
                        <p className="mt-0.5 text-xs text-soil leading-relaxed">
                          {details.join(', ')}
                        </p>
                      ) : ci.optionsLabel ? (
                        <p className="mt-0.5 text-xs text-soil">{ci.optionsLabel}</p>
                      ) : null}
                    </div>

                    <p className="text-sm font-semibold text-sage">
                      {formatRupiah(ci.price)}
                    </p>
                  </div>

                  {/* Aksi Kanan (Tombol Hapus & Stepper Jumlah) */}
                  <div className="flex flex-col items-end justify-between shrink-0">
                    {/* Tombol Hapus (Kanan Atas) */}
                    <button
                      className="text-xs text-soil hover:text-red-500 transition-colors"
                      onClick={() => onUpdateQty(ci.cartId, -ci.quantity)}
                    >
                      Hapus
                    </button>

                    {/* Stepper Jumlah (Kanan Bawah) */}
                    <div className="flex h-8 w-fit items-center rounded-full" style={{ background: `${theme.accent}33` }}>
                      <button
                        className="flex size-8 items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                        onClick={() => onUpdateQty(ci.cartId, -1)}
                        disabled={ci.quantity <= 1} // Mencegah terhapus jika sisa 1
                      >
                        <IconMinus color="#1A2816" />
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">
                        {ci.quantity}
                      </span>
                      <button
                        className="flex size-8 items-center justify-center"
                        onClick={() => onUpdateQty(ci.cartId, 1)}
                      >
                        <IconPlus color="#1A2816" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            <button onClick={onBack} className="py-2 text-left text-base text-ink font-medium">
              + Tambah Item Lain
            </button>
          </section>
          <section>
            <h2 className="font-display mb-3 text-xl font-bold">
              Metode Pembayaran
            </h2>
            <div className="flex flex-col gap-2">
              {availableMethods.length === 0 ? (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-[#ba1a1a]">Metode pembayaran belum dikonfigurasi. Hubungi kasir.</p>
              ) : availableMethods.map((m) => {
                return (
                <button
                  key={m.id}
                  onClick={() => onPayMethod(m.id)}
                  style={payMethod === m.id ? { borderColor: theme.accent } : undefined}
                  className={`flex items-center justify-between rounded-[8px] border bg-white p-[13px] text-left ${
                    payMethod === m.id ? "" : "border-clay"
                  }`}
                >
                  <div className="flex-1 pr-2">
                    <p className="text-sm font-bold">{m.label}</p>
                    <p className="text-[10px] text-soil">{m.sub}</p>
                  </div>
                  {payMethod === m.id && (
                    <span
                      className="flex size-5 items-center justify-center rounded-full text-[10px] text-white shrink-0"
                      style={{ background: theme.accent }}
                    >
                      ✓
                    </span>
                  )}
                </button>
              )})}
            </div>
            {payMethod === 'bank_transfer' && (
              <div className="rounded-[12px] border border-sand bg-cream/40 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-stone mb-2">Pilih Bank Tujuan</p>
                <div className="grid grid-cols-3 gap-2">
                  {visibleBanks.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onSelectBank(b.id)}
                      style={selectedBank === b.id ? { borderColor: theme.primary, background: theme.primary, color: '#fff' } : undefined}
                      className={`rounded-lg border py-2 text-xs font-bold uppercase ${selectedBank === b.id ? '' : 'border-clay bg-white text-stone'}`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="rounded-[12px] bg-[#f3f3f3] p-5">
            <h2 className="font-display mb-2 text-xl font-semibold">
              Ringkasan Pesanan
            </h2>
            <div className="flex justify-between py-1 text-soil">
              <span>Sub total ({cart.reduce((acc, ci) => acc + ci.quantity, 0)} item)</span>
              <span className="text-ink">{formatRupiah(subtotal)}</span>
            </div>
            {serviceCharge > 0 && (
              <div className="flex justify-between py-1 text-soil">
                <span>Service {business.serviceChargeMode === 'flat' ? '(flat)' : `(${business.serviceChargeRate}%)`}</span>
                <span className="text-ink">{formatRupiah(serviceCharge)}</span>
              </div>
            )}
            {/* Rincian pajak/fee hanya bila ditanggung pelanggan; bila ditanggung kafe disembunyikan total. */}
            {business.taxEnabled && tax > 0 && business.taxBearer !== 'cafe' && (
              <div className="flex justify-between py-1 text-soil">
                <span>
                  {business.taxLabel} {business.taxRate}%
                </span>
                <span className="text-ink">{formatRupiah(tax)}</span>
              </div>
            )}
            {/* {!business.taxEnabled && <div className="flex justify-between py-1 text-soil"><span>Pajak</span><span className="text-ink">Rp0 (nonaktif)</span></div>} */}
            {platformFee > 0 && business.platformFeeBearer !== 'cafe' && (
              <div className="flex justify-between py-1 text-soil">
                <span>{platformFeeLabel(business, formatRupiah)}</span>
                <span className="text-ink">{formatRupiah(platformFee)}</span>
              </div>
            )}
            <div className="my-2 h-px bg-clay/50" />
            <div className="flex justify-between py-2">
              <span className="font-display text-2xl font-bold">Total</span>
              <span className="font-display text-2xl font-bold" style={{ color: theme.accent }}>
                {formatRupiah(total)}
              </span>
            </div>
          </section>
        </div>
      </div>
      <div className="fixed bottom-20 left-0 right-0 z-10 mx-auto flex w-full max-w-md items-center justify-between rounded-t-[12px] border-t border-clay/20 bg-white px-4 pb-4 pt-[17px]">
      <div>
        <p className="text-xs text-soil">Total Tagihan</p>
        <p className="font-display text-xl font-bold" style={{ color: theme.accent }}>
          {formatRupiah(total)}
        </p>
      </div>
      <Button
        className="h-12 rounded-full px-8 disabled:opacity-50"
        style={{ background: theme.primary }}
        disabled={cart.length === 0 || !customerName.trim() || availableMethods.length === 0}
        onClick={handleCheckout}
      >
        Pesan Sekarang
      </Button>
    </div>
    </div>
  );
}
