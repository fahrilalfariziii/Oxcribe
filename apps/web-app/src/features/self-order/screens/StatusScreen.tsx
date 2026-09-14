import type { CartItem, Order, OrderStatus } from '../../../shared/types'
import { normalizeTheme } from '../../../shared/types'
import { formatRupiah } from '../../../shared/lib/format'
import { Button } from '../../../shared/components/ui'
import { useCafe } from '../../../mock/store'

interface Props {
  order: Order | null
  cart: CartItem[]
  tableNumber: string
  onOrderAgain: () => void
  onEndSession?: () => void
  onOpenHistory?: () => void
}

const STEPS: { id: OrderStatus; label: string }[] = [
  { id: 'diterima', label: 'Diterima' },
  { id: 'diproses', label: 'Diproses' },
  { id: 'siap', label: 'Siap' },
  { id: 'selesai', label: 'Selesai' },
]

export function StatusScreen({ order, cart, tableNumber, onOrderAgain, onEndSession, onOpenHistory }: Props) {
  const { business } = useCafe()
  const theme = normalizeTheme(business.theme)
  const status = order?.status ?? 'diterima'
  // Status 'batal' tidak ada di STEPS -> idx -1 agar seluruh langkah tampil abu-abu.
  const idx = STEPS.findIndex((s) => s.id === status)
  const items = order?.items ?? cart.map((c) => ({
    id: c.cartId,
    productName: c.name,
    quantity: c.quantity,
    optionsLabel: c.optionsLabel,
    subtotal: c.price * c.quantity,
  }))
  const total = order?.total ?? items.reduce((s, i) => s + i.subtotal, 0)
  const headline =
    status === 'batal' ? 'PESANAN DIBATALKAN' : status === 'selesai' ? 'PESANAN SELESAI' : status === 'siap' ? 'SIAP DISAJIKAN' : status === 'diproses' ? 'SEDANG DISIAPKAN' : 'PESANAN DITERIMA'

  return (
    <div className="flex h-full flex-col" style={{ background: theme.pageBg }}>
      <header className="flex h-12 items-center justify-center shadow-sm">
        <span className="font-display text-2xl font-semibold">{business.name}</span>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-6 pb-24 scrollbar-hide">
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          <span className="rounded-full px-6 py-2 text-sm font-semibold tracking-[0.7px] text-white" style={{ background: theme.primary }}>
            {headline}
          </span>
          <p className="text-soil">
            {status === 'selesai'
              ? 'Selamat menikmati makanan/minuman Anda.'
              : status === 'batal'
                ? 'Pesanan ini dibatalkan (mis. pembayaran kedaluwarsa). Silakan pesan ulang.'
                : status === 'siap'
                  ? 'Pesanan Anda sudah siap. Silakan ambil di counter atau tunggu penyajian ke meja.'
                  : 'Barista kami sedang meracik pesanan Anda dengan penuh perhatian.'}
          </p>
        </div>
        <div className="mb-10 flex w-full items-center justify-between px-2">
          {STEPS.map((step, i) => (
            <div key={step.id} className="flex flex-1 items-center last:flex-none">
              {/* Lingkaran dan Label Status */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`flex size-10 items-center justify-center rounded-full text-xs font-bold text-white transition-colors ${
                    i <= idx ? '' : 'bg-[#e2e2e2] !text-[#80756c]'
                  }`}
                  style={i <= idx ? { background: theme.primary } : undefined}
                >
                  {i < idx ? '✓' : i + 1}
                </div>
                <span className={`text-xs whitespace-nowrap ${
                    i <= idx ? 'font-bold text-ink' : 'text-[#80756c]'
                  }`}> {step.label}
                </span>
              </div>

              {/* Garis Penghubung (Hanya muncul di antara langkah, bukan setelah langkah terakhir) */}
              {i < STEPS.length - 1 && (
                <div
                  className={`mx-3 -mt-6 h-1 flex-1 rounded-full transition-colors ${
                    i < idx ? '' : 'bg-clay/40'
                  }`}
                  style={i < idx ? { background: theme.primary } : undefined}
                />
              )}
            </div>
          ))}
        </div>
        <div className="rounded-[12px] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-[#e2e2e2] pb-2">
            <span className="font-display text-xl">{order ? `Order #${order.orderNumber}` : 'Pesanan'}</span>
            <span className="text-xs text-soil">Meja {order?.tableNumber ?? tableNumber}</span>
          </div>
          <div className="flex flex-col gap-2 py-3">
            {items.map((ci) => (
              <div key={ci.id} className="flex items-start justify-between">
                <div className="flex gap-3">
                  <span className="rounded-[8px] bg-[#eee] px-2 py-1 text-sm font-bold">{ci.quantity}x</span>
                  <div>
                    <p className="font-semibold">{ci.productName}</p>
                    {'optionsLabel' in ci && ci.optionsLabel && (
                      <p className="text-xs text-soil">{ci.optionsLabel}</p>
                    )}
                  </div>
                </div>
                <span className="font-semibold">{formatRupiah(ci.subtotal)}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t border-[#e2e2e2] pt-3">
            {/* Rincian hanya bila ditanggung pelanggan; bila ditanggung kafe disembunyikan total. */}
            {order?.taxBearer !== 'cafe' && (
            <div className="flex items-center justify-between text-sage">
              <span className="font-bold text-ink">Pajak</span>
              <span className="font-display text-l font-bold text-sage">
                {formatRupiah(order?.tax ?? 0)}
              </span>
            </div>
            )}
            {(order?.platformFee ?? 0) > 0 && order?.platformFeeBearer !== 'cafe' && (
              <div className="flex items-center justify-between text-sage">
                <span className="font-bold text-ink">Biaya layanan</span>
                <span className="font-display text-l font-bold text-sage">
                  {formatRupiah(order?.platformFee ?? 0)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink">Total Harga</span>
              <span className="font-display text-l font-bold text-sage">
                {formatRupiah(total)}
              </span>
            </div>
          </div>
        </div>
        {order?.paymentMethod === 'cash' && order.paymentStatus !== 'paid' && (
          <p className="mt-4 rounded-[12px] bg-sand p-4 text-sm">Segera Bayar dikasir, agar pesanan segera diproses.</p>
        )}
        <div className="mt-8 flex flex-col gap-2">
          <Button className="h-12 w-full rounded-full" onClick={onOrderAgain}>
            Pesan Lagi
          </Button>
          <div className="flex gap-2">
            {onOpenHistory && (
              <button
                onClick={onOpenHistory}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-clay bg-white text-xs font-semibold text-stone"
              >
                <span className="material-symbols-outlined text-[16px]">history</span>
                <span>Riwayat Saya</span>
              </button>
            )}
            {onEndSession && (
              <button
                onClick={onEndSession}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-clay bg-white text-xs font-semibold text-stone"
                title="Tutup sesi & hapus riwayat di HP ini"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                <span>Selesai</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
