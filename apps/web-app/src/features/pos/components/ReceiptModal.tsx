import type { Order } from '../../../shared/types'
import { formatRupiah, formatTime } from '../../../shared/lib/format'
import { estimateMdrPreview, netEstimate } from '../../../shared/lib/fees'
import { useCafe } from '../../../mock/store'

interface Props {
  order: Order
  onClose: () => void
}

export function ReceiptModal({ order, onClose }: Props) {
  const { business } = useCafe()
  // MDR: pakai snapshot order bila ada; order lama (snapshot 0) pakai estimasi live.
  // Selalu berlabel estimasi — angka aktual mengikuti settlement DOKU.
  const mdrLive = estimateMdrPreview(order.total, order.paymentMethod)
  const mdrFee = (order.mdrFee ?? 0) > 0 ? order.mdrFee : mdrLive.fee
  const net = netEstimate({ total: order.total, platformFee: order.platformFee ?? 0, mdrFee })

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      {/* Backdrop Klik untuk Tutup */}
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-sm flex-col rounded-[16px] bg-white shadow-2xl">
        {/* Header Modal */}
        <div className="flex items-center justify-between border-b border-sand px-5 py-4 print:hidden">
          <h3 className="font-semibold text-black">Pratinjau Struk</h3>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full bg-sand text-stone hover:bg-[#e6e2d9]"
          >
            ✕
          </button>
        </div>

        {/* Tampilan Struk Fisik Thermal 58mm/80mm */}
        <div className="flex-1 overflow-y-auto p-6 font-mono text-xs text-black">
          <div className="text-center">
            <h2 className="text-base font-bold uppercase tracking-wider">{business.name}</h2>
            <p className="mt-1 text-[11px] text-stone">{business.address}</p>
            <p className="text-[11px] text-stone">Telp: {business.phone}</p>
            <div className="my-3 border-b border-dashed border-black/40" />
          </div>

          {/* Info Transaksi */}
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span>No. Nota:</span>
              <span className="font-bold">#{order.orderNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Tanggal:</span>
              <span>{formatTime(order.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span>Pelanggan:</span>
              <span>{order.customerName}</span>
            </div>
            <div className="flex justify-between">
              <span>Lokasi/Meja:</span>
              <span>{order.tableNumber ? `Meja ${order.tableNumber}` : 'Kasir'}</span>
            </div>
          </div>

          <div className="my-3 border-b border-dashed border-black/40" />

          {/* Item Pesanan */}
          <div className="space-y-2">
            {order.items.map((it) => (
              <div key={it.id}>
                <div className="flex justify-between font-semibold">
                  <span>{it.productName}</span>
                  <span>{formatRupiah(it.subtotal)}</span>
                </div>
                <div className="flex justify-between text-[10px] text-stone">
                  <span>
                    {it.quantity} × {formatRupiah(it.price)}
                  </span>
                  {it.optionsLabel && <span>({it.optionsLabel})</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="my-3 border-b border-dashed border-black/40" />

          {/* Rincian Total */}
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatRupiah(order.subtotal)}</span>
            </div>
            {order.serviceCharge > 0 && (
              <div className="flex justify-between">
                <span>Service</span>
                <span>{formatRupiah(order.serviceCharge)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>
                Pajak ({order.taxLabel}){order.taxBearer === 'cafe' ? ' (ditanggung kafe)' : ''}
              </span>
              <span>{formatRupiah(order.tax)}</span>
            </div>
            {(order.platformFee ?? 0) > 0 && (
              <div className="flex justify-between">
                <span>
                  Biaya layanan{(order.platformFeeBearer === 'cafe') ? ' (ditanggung kafe)' : ''}
                </span>
                <span>{formatRupiah(order.platformFee)}</span>
              </div>
            )}
            <div className="my-1 border-b border-dotted border-black/30" />
            <div className="flex justify-between text-xs font-bold">
              <span>TOTAL{order.taxBearer === 'cafe' ? ' (tanpa pajak)' : ''}</span>
              <span>{formatRupiah(order.total)}</span>
            </div>
            <div className="flex justify-between pt-1 text-[10px] uppercase text-stone">
              <span>Metode Bayar</span>
              <span>{order.paymentMethod}</span>
            </div>
            {/* Rincian owner — layar saja, TIDAK ikut tercetak (keputusan produk) */}
            <div className="print:hidden">
              <div className="my-1 border-b border-dotted border-black/30" />
              <p className="pb-1 text-[10px] font-bold uppercase text-stone">Rincian owner (estimasi)</p>
              <div className="flex justify-between">
                <span>Omset kotor</span>
                <span>{formatRupiah(order.total)}</span>
              </div>
              <div className="flex justify-between">
                <span>Potongan aplikasi</span>
                <span>-{formatRupiah(order.platformFee ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>{mdrLive.label}</span>
                <span>-{formatRupiah(mdrFee)}</span>
              </div>
              <div className="flex justify-between pt-1 text-xs font-bold">
                <span>Pendapatan bersih (est.)</span>
                <span>{formatRupiah(net)}</span>
              </div>
            </div>
          </div>

          <div className="my-4 border-b border-dashed border-black/40" />

          {/* Footer Struk */}
          <div className="text-center text-[10px] text-stone">
            <p className="font-semibold text-black">Terima Kasih atas Kunjungan Anda!</p>
            <p className="mt-0.5">Wifi Password: kopi-nikmat-123</p>
          </div>
        </div>

        {/* Tombol Cetak / Aksi */}
        <div className="flex gap-3 border-t border-sand p-4 print:hidden">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-clay py-2.5 text-xs font-semibold text-stone hover:bg-sand transition-colors"
          >
            Tutup
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-black py-2.5 text-xs font-semibold text-white hover:bg-black/80 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">print</span>
            <span>Cetak Sekarang</span>
          </button>
        </div>
      </div>
    </div>
  )
}