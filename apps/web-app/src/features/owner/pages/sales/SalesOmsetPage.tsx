import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useCafe } from '../../../../mock/store'
import { formatRupiah, formatTime } from '../../../../shared/lib/format'
import { bucketizePaidOrders, filterPaidOrders } from '../../../../shared/lib/sales'
import { isFeatureOn } from '../../../../shared/lib/features'
import { estimateMdrPreview, netEstimate } from '../../../../shared/lib/fees'

type OmsetView = 'omset' | 'sales_type'

function compactRp(v: number): string {
  if (v >= 1000000) return `${(v / 1000000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`
  if (v >= 1000) return `${Math.round(v / 1000)}rb`
  return String(Math.round(v))
}

export function SalesOmsetPage() {
  const { orders, business } = useCafe()
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [activeView, setActiveView] = useState<OmsetView>('omset')
  // Kill-switch: Starter (analyticsFull OFF) = angka ringkas saja;
  // salesType OFF = tab Sales Type disembunyikan; exportCsv OFF = tombol ekspor hilang.
  const fullOn = isFeatureOn(business, 'analyticsFull')
  const salesTypeOn = fullOn && isFeatureOn(business, 'salesType')
  const exportOn = isFeatureOn(business, 'exportCsv')
  const effectiveView: OmsetView = activeView === 'sales_type' && !salesTypeOn ? 'omset' : activeView

  const paidOrders = useMemo(() => filterPaidOrders(orders, selectedYear), [orders, selectedYear])

  const totalRevenue = paidOrders.reduce((s, o) => s + o.total, 0)
  const totalOrdersCount = paidOrders.length
  const avgOrderValue = totalOrdersCount > 0 ? totalRevenue / totalOrdersCount : 0

  const selfOrders = useMemo(() => paidOrders.filter((o) => o.source === 'self_order'), [paidOrders])
  const manualOrders = useMemo(() => paidOrders.filter((o) => o.source === 'pos'), [paidOrders])
  const selfRevenue = selfOrders.reduce((s, o) => s + o.total, 0)
  const manualRevenue = manualOrders.reduce((s, o) => s + o.total, 0)

  // Agregasi REAL dari transaksi (sumber tunggal dengan Dashboard)
  const chartData = useMemo(() => bucketizePaidOrders(paidOrders, period), [paidOrders, period])
  const hasChartData = chartData.some((d) => d.total > 0)

  function exportSalesCSV() {
    if (!exportOn) return
    const feeCols = (o: (typeof paidOrders)[number]) => {
      const mdr = (o.mdrFee ?? 0) > 0 ? o.mdrFee : estimateMdrPreview(o.total, o.paymentMethod).fee
      return [o.platformFee ?? 0, mdr, netEstimate({ total: o.total, platformFee: o.platformFee ?? 0, mdrFee: mdr })]
    }
    if (effectiveView === 'sales_type') {
      const headers = ['Waktu', 'No Order', 'Sales Type', 'Items', 'Total Tagihan', 'Biaya Layanan', 'MDR (est.)', 'Bersih (est.)']
      const rows = paidOrders.map((o) => [
        formatTime(o.createdAt),
        `#${o.orderNumber}`,
        o.source === 'self_order' ? 'Self Order' : 'Manual Order',
        `"${o.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}"`,
        o.total,
        ...feeCols(o),
      ])
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
      const link = document.createElement('a')
      link.setAttribute('href', encodeURI(csvContent))
      link.setAttribute('download', `Sales_Type_${selectedYear}_${period}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      return
    }
    const headers = ['Waktu', 'No Order', 'Items', 'Status Pembayaran', 'Total Tagihan', 'Biaya Layanan', 'MDR (est.)', 'Bersih (est.)']
    const rows = paidOrders.map((o) => [
      formatTime(o.createdAt),
      `#${o.orderNumber}`,
      `"${o.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}"`,
      o.paymentStatus,
      o.total,
      ...feeCols(o),
    ])
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
    const link = document.createElement('a')
    link.setAttribute('href', encodeURI(csvContent))
    link.setAttribute('download', `Laporan_Omset_${selectedYear}_${period}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Laporan Omset</h1>
          <p className="text-stone">Ringkasan pendapatan dan grafik statistik transaksi.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="h-10 rounded-lg border border-[#c4c7c7] bg-white px-3 text-xs font-semibold outline-none focus:border-black"
          >
            {[2024, 2025, 2026].map((yr) => (
              <option key={yr} value={yr}>
                Tahun {yr}
              </option>
            ))}
          </select>

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
            <span>Ekspor {effectiveView === 'sales_type' ? 'Sales Type' : 'Omset'} (CSV)</span>
          </button>
          )}
        </div>
      </div>

      {/* Kategori bar: Omset | Sales Type (disembunyikan bila flag salesType OFF) */}
      {salesTypeOn ? (
      <div className="flex gap-2 rounded-lg border border-[#c4c7c7] bg-cream p-1.5">
        <button
          onClick={() => setActiveView('omset')}
          className={`flex-1 rounded-md px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
            effectiveView === 'omset' ? 'bg-black text-white shadow-xs' : 'bg-white text-stone hover:text-black border border-sand'
          }`}
        >
          Omset
        </button>
        <button
          onClick={() => setActiveView('sales_type')}
          className={`flex-1 rounded-md px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
            effectiveView === 'sales_type' ? 'bg-black text-white shadow-xs' : 'bg-white text-stone hover:text-black border border-sand'
          }`}
        >
          Sales Type
        </button>
      </div>
      ) : null}

      {effectiveView === 'omset' ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <article className="rounded-[12px] bg-cream p-5 border border-[#c4c7c7]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Total Omset ({period} - {selectedYear})</p>
              <p className="mt-2 text-[28px] font-bold text-black">{formatRupiah(totalRevenue)}</p>
            </article>
            <article className="rounded-[12px] bg-cream p-5 border border-[#c4c7c7]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Total Transaksi</p>
              <p className="mt-2 text-[28px] font-bold text-black">{totalOrdersCount} Pesanan</p>
            </article>
            <article className="rounded-[12px] bg-cream p-5 border border-[#c4c7c7]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Rata-rata Transaksi</p>
              <p className="mt-2 text-[28px] font-bold text-black">{formatRupiah(avgOrderValue)}</p>
            </article>
          </div>

          <div className="rounded-[12px] border border-[#c4c7c7] bg-white p-6 shadow-2xs">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-black">Grafik Penjualan</h2>
              <span className="material-symbols-outlined text-stone">show_chart</span>
            </div>
            {!fullOn ? (
              <p className="text-sm text-stone">Grafik lengkap tidak termasuk paket kafe Anda — ringkasan angka di atas tetap tersedia. Hubungi tim sales Ordria untuk upgrade.</p>
            ) : hasChartData ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e2dd" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#78716c' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={compactRp} tick={{ fontSize: 10, fill: '#78716c' }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip
                      formatter={(value, name) => [formatRupiah(Number(value)), name === 'total' ? 'Omset' : String(name)]}
                      contentStyle={{ borderRadius: 12, fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey="total" name="Omset" stroke="#4a7c59" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
                <span className="material-symbols-outlined text-4xl text-stone">show_chart</span>
                <p className="text-sm font-medium text-stone">Belum ada transaksi lunas pada periode ini.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <article className="rounded-[12px] bg-cream p-5 border border-[#c4c7c7]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Self Order</p>
              <p className="mt-2 text-[28px] font-bold text-black">{formatRupiah(selfRevenue)}</p>
              <p className="text-xs text-stone">{selfOrders.length} transaksi</p>
            </article>
            <article className="rounded-[12px] bg-cream p-5 border border-[#c4c7c7]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Manual Order</p>
              <p className="mt-2 text-[28px] font-bold text-black">{formatRupiah(manualRevenue)}</p>
              <p className="text-xs text-stone">{manualOrders.length} transaksi</p>
            </article>
            <article className="rounded-[12px] bg-white p-5 border border-[#c4c7c7]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Proporsi</p>
              <p className="mt-2 text-[20px] font-bold text-black">
                {totalRevenue > 0 ? `${Math.round((selfRevenue / totalRevenue) * 100)}% Self / ${Math.round((manualRevenue / totalRevenue) * 100)}% Manual` : '-'}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sage to-[#4a7c59]"
                  style={{ width: `${totalRevenue > 0 ? Math.round((selfRevenue / totalRevenue) * 100) : 0}%` }}
                />
              </div>
            </article>
          </div>

          <div className="rounded-[12px] border border-[#c4c7c7] bg-white p-6 shadow-2xs">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-black">Grafik Sales Type</h2>
              <span className="material-symbols-outlined text-stone">show_chart</span>
            </div>
            {hasChartData ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e2dd" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#78716c' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={compactRp} tick={{ fontSize: 10, fill: '#78716c' }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip
                      formatter={(value, name) => [formatRupiah(Number(value)), name === 'self' ? 'Self Order' : 'Manual Order']}
                      contentStyle={{ borderRadius: 12, fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="self" name="Self Order" stroke="#4a7c59" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="manual" name="Manual Order" stroke="#1c1917" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
                <span className="material-symbols-outlined text-4xl text-stone">show_chart</span>
                <p className="text-sm font-medium text-stone">Belum ada transaksi lunas pada periode ini.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
