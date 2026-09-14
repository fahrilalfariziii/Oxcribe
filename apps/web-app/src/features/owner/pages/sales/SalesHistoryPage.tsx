import { useMemo, useState } from 'react'
import { Fragment } from 'react'
import { useCafe } from '../../../../mock/store'
import { formatRupiah, formatTime } from '../../../../shared/lib/format'
import { isFeatureOn } from '../../../../shared/lib/features'
import { estimateMdrPreview, netEstimate } from '../../../../shared/lib/fees'

export function SalesHistoryPage() {
  const { orders, business } = useCafe()
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [pageSize, setPageSize] = useState<number>(30)
  const [page, setPage] = useState<number>(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const exportOn = isFeatureOn(business, 'exportCsv')

  const paidOrders = useMemo(() => {
    return orders
      .filter((o) => {
        const orderYear = new Date(o.createdAt).getFullYear()
        return o.paymentStatus === 'paid' && orderYear === selectedYear
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [orders, selectedYear])

  const totalPages = Math.max(1, Math.ceil(paidOrders.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const visibleOrders = paidOrders.slice((safePage - 1) * pageSize, safePage * pageSize)

  function changePageSize(n: number) {
    setPageSize(n)
    setPage(1)
  }

  function exportSalesCSV() {
    if (!exportOn) return
    const headers = ['Waktu', 'No Order', 'Items', 'Status Pembayaran', 'Total Tagihan', 'Biaya Layanan', 'MDR (est.)', 'Bersih (est.)']
    const rows = paidOrders.map((o) => {
      const mdr = (o.mdrFee ?? 0) > 0 ? o.mdrFee : estimateMdrPreview(o.total, o.paymentMethod).fee
      return [
        formatTime(o.createdAt),
        `#${o.orderNumber}`,
        `"${o.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}"`,
        o.paymentStatus,
        o.total,
        o.platformFee ?? 0,
        mdr,
        netEstimate({ total: o.total, platformFee: o.platformFee ?? 0, mdrFee: mdr }),
      ]
    })

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `Riwayat_Transaksi_${selectedYear}_${period}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Riwayat Transaksi</h1>
          <p className="text-stone">Seluruh riwayat pesanan yang sudah terbayar.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedYear}
            onChange={(e) => { setSelectedYear(Number(e.target.value)); setPage(1) }}
            className="h-10 rounded-lg border border-[#c4c7c7] bg-white px-3 text-xs font-semibold outline-none focus:border-black"
          >
            {[2024, 2025, 2026].map((yr) => (
              <option key={yr} value={yr}>
                Tahun {yr}
              </option>
            ))}
          </select>

          {/* FILTER PERIODE HARIAN, MINGGUAN, BULANAN */}
          <div className="flex rounded-lg border border-[#c4c7c7] bg-sand/50 p-1">
            {(['daily', 'weekly', 'monthly'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                  period === p ? 'bg-black text-white shadow-xs' : 'text-stone hover:text-black'
                }`}
              >
                {p === 'daily' ? 'Harian' : p === 'weekly' ? 'Mingguan' : 'Bulanan'}
              </button>
            ))}
          </div>

          {exportOn && (
          <button
            onClick={exportSalesCSV}
            className="flex h-10 items-center gap-2 rounded-lg bg-black px-4 text-xs font-semibold text-white hover:bg-black/80 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>Ekspor Transaksi</span>
          </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[#c4c7c7] bg-white shadow-xs">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f7f3ea]/50 text-[11px] uppercase tracking-wider text-stone border-b border-sand">
            <tr>
              <th className="px-4 py-3">Waktu</th>
              <th className="px-4 py-3">No. Order</th>
              <th className="px-4 py-3">Daftar Item</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total Tagihan</th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.map((o) => {
              const mdrLive = estimateMdrPreview(o.total, o.paymentMethod)
              const mdr = (o.mdrFee ?? 0) > 0 ? o.mdrFee : mdrLive.fee
              const net = netEstimate({ total: o.total, platformFee: o.platformFee ?? 0, mdrFee: mdr })
              const open = expandedId === o.id
              return (
              <Fragment key={o.id}>
              <tr
                onClick={() => setExpandedId(open ? null : o.id)}
                className="cursor-pointer border-t border-sand hover:bg-cream/40 transition-colors"
                title="Klik untuk rincian fee & pendapatan bersih"
              >
                <td className="px-4 py-3 text-stone">{formatTime(o.createdAt)}</td>
                <td className="px-4 py-3 font-semibold text-black">#{o.orderNumber}</td>
                <td className="px-4 py-3 text-stone">
                  {o.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-[#b8cda9]/40 px-2.5 py-0.5 text-[10px] font-bold uppercase text-sage">
                    {o.paymentStatus}
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold text-black text-right">{formatRupiah(o.total)}</td>
              </tr>
              {open && (
              <tr className="border-t border-dashed border-sand bg-cream/60">
                <td colSpan={5} className="px-4 py-3">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                    <div className="flex justify-between gap-2"><span className="text-stone">Omset kotor</span><span className="font-semibold">{formatRupiah(o.total)}</span></div>
                    <div className="flex justify-between gap-2"><span className="text-stone">Biaya layanan{(o.platformFeeBearer === 'cafe') ? ' (kafe)' : ''}</span><span className="font-semibold">-{formatRupiah(o.platformFee ?? 0)}</span></div>
                    <div className="flex justify-between gap-2"><span className="text-stone">{mdrLive.label}</span><span className="font-semibold">-{formatRupiah(mdr)}</span></div>
                    <div className="flex justify-between gap-2"><span className="text-stone">Bersih (est.)</span><span className="font-bold text-sage">{formatRupiah(net)}</span></div>
                  </div>
                </td>
              </tr>
              )}
              </Fragment>
              )
            })}

            {paidOrders.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-muted">
                  Tidak ada transaksi terverifikasi pada tahun {selectedYear}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginasi: radio jumlah data + prev/next */}
      {paidOrders.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#c4c7c7] bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone">Tampilkan:</span>
            {[10, 30, 50, 100].map((n) => (
              <label key={n} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${pageSize === n ? 'border-black bg-black text-white' : 'border-clay bg-white text-stone hover:border-black'}`}>
                <input
                  type="radio"
                  name="history-page-size"
                  checked={pageSize === n}
                  onChange={() => changePageSize(n)}
                  className="sr-only"
                />
                <span>{n}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="flex h-9 items-center gap-1 rounded-lg border border-clay bg-white px-3 text-xs font-semibold text-stone hover:border-black hover:text-black disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              <span>Prev</span>
            </button>
            <span className="text-xs text-stone">
              Hal {safePage} dari {totalPages} · {paidOrders.length} transaksi
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="flex h-9 items-center gap-1 rounded-lg border border-clay bg-white px-3 text-xs font-semibold text-stone hover:border-black hover:text-black disabled:opacity-40"
            >
              <span>Next</span>
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}