import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useCafe } from '../../../mock/store'
import { formatRupiah } from '../../../shared/lib/format'
import { bucketizePaidOrders, filterPaidOrders } from '../../../shared/lib/sales'
import { isFeatureOn } from '../../../shared/lib/features'
import { estimateMdrPreview } from '../../../shared/lib/fees'

const RANK_MEDAL = ['🥇', '🥈', '🥉']

function compactRp(v: number): string {
  if (v >= 1000000) return `${(v / 1000000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`
  if (v >= 1000) return `${Math.round(v / 1000)}rb`
  return String(Math.round(v))
}

export function DashboardPage() {
  const { orders, products, business } = useCafe()
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [selectedYear] = useState<number>(new Date().getFullYear())
  // Paket Starter (analyticsFull OFF) = ringkasan angka saja, tanpa grafik & top item.
  const fullOn = isFeatureOn(business, 'analyticsFull')

  const paid = useMemo(() => filterPaidOrders(orders, selectedYear), [orders, selectedYear])
  const revenue = paid.reduce((s, o) => s + o.total, 0)
  const avg = paid.length ? revenue / paid.length : 0
  // Transparansi pendapatan: agregat fee & MDR estimasi (snapshot per order,
  // order lama tanpa snapshot memakai estimasi live dari total).
  const feeTotal = paid.reduce((s, o) => s + (o.platformFee ?? 0), 0)
  const mdrTotal = paid.reduce((s, o) => {
    const snap = o.mdrFee ?? 0
    return s + (snap > 0 ? snap : estimateMdrPreview(o.total, o.paymentMethod).fee)
  }, 0)
  const netTotal = revenue - feeTotal - mdrTotal

  const chart = useMemo(() => bucketizePaidOrders(paid, period), [paid, period])
  const chartMax = Math.max(...chart.map((c) => c.total), 0)
  const hasData = chart.some((c) => c.total > 0)

  const counts = new Map<string, { qty: number; revenue: number }>()
  for (const o of paid) {
    for (const i of o.items) {
      const cur = counts.get(i.productName) ?? { qty: 0, revenue: 0 }
      counts.set(i.productName, { qty: cur.qty + i.quantity, revenue: cur.revenue + i.price * i.quantity })
    }
  }
  const best = [...counts.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)
  const bestMax = Math.max(...best.map((b) => b.qty), 1)
  const oos = products.filter((p) => !p.isAvailable)

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[40px] font-semibold tracking-tight">Dashboard Overview</h1>
          <p className="text-muted">Today's Performance</p>
        </div>
        <div className="flex rounded-[12px] border border-[#c4c7c7] bg-[#f2ede4] p-[5px]">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-[8px] px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.6px] ${
                period === p ? 'bg-cream text-black shadow-sm' : 'text-muted'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {[
          { label: 'Total Revenue', value: formatRupiah(revenue), hint: paid.length ? `${paid.length} transaksi lunas` : 'Belum ada transaksi' },
          { label: 'Total Orders', value: String(paid.length), hint: paid.length ? 'Transaksi lunas' : 'Belum ada order' },
          { label: 'Avg. Transaction', value: formatRupiah(Math.round(avg)), hint: paid.length ? 'Rata-rata per transaksi' : '-' },
        ].map((k) => (
          <article key={k.label} className="flex h-32 flex-col justify-between rounded-[12px] bg-cream p-6 ring-1 ring-[#e4e2dd]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.6px] text-muted">{k.label}</p>
            <div>
              <p className="text-[28px] font-bold tracking-tight">{k.value}</p>
              <p className="text-sm text-stone">{k.hint}</p>
            </div>
          </article>
        ))}
      </div>
      {fullOn && (
      <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {[
          { label: 'Potongan Aplikasi', value: formatRupiah(feeTotal), hint: 'Total platform fee self-order' },
          { label: 'MDR Midtrans (est.)', value: formatRupiah(mdrTotal), hint: 'Estimasi tabel resmi' },
          { label: 'Pendapatan Bersih (est.)', value: formatRupiah(netTotal), hint: 'Kotor − fee − MDR' },
        ].map((k) => (
          <article key={k.label} className="flex h-32 flex-col justify-between rounded-[12px] bg-[#f5f0e7] p-6 ring-1 ring-[#e4e2dd]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.6px] text-muted">{k.label}</p>
            <div>
              <p className="text-[28px] font-bold tracking-tight">{k.value}</p>
              <p className="text-sm text-stone">{k.hint}</p>
            </div>
          </article>
        ))}
      </div>
      )}
      <div className="grid grid-cols-12 gap-6">
        {fullOn ? (
        <section className="col-span-12 min-h-[400px] rounded-[12px] bg-cream p-6 ring-1 ring-[#e4e2dd] xl:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Omset {period}</h2>
            <span className="text-[12px] font-semibold uppercase tracking-wider text-muted">
              {hasData ? `${formatRupiah(chartMax)} puncak` : 'Belum ada data'}
            </span>
          </div>
          {hasData ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="omsetFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4a7c59" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#4a7c59" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e2dd" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#78716c' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={compactRp} tick={{ fontSize: 10, fill: '#78716c' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip
                    formatter={(value) => [formatRupiah(Number(value)), 'Omset']}
                    labelFormatter={(l) => `Waktu: ${l}`}
                    contentStyle={{ borderRadius: 12, fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="total" stroke="#4a7c59" strokeWidth={2.5} fill="url(#omsetFill)" dot={false} activeDot={{ r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
              <span className="material-symbols-outlined text-4xl text-stone">show_chart</span>
              <p className="text-sm font-medium text-stone">Belum ada transaksi lunas pada periode ini.</p>
              <p className="text-xs text-muted">Grafik terisi otomatis saat ada pembayaran masuk.</p>
            </div>
          )}
        </section>
        ) : (
        <section className="col-span-12 rounded-[12px] bg-cream p-6 ring-1 ring-[#e4e2dd] xl:col-span-8">
          <h2 className="text-lg font-semibold">Grafik analitik penuh</h2>
          <p className="mt-1 text-sm text-stone">Paket kafe Anda hanya mencakup ringkasan angka di atas. Hubungi tim sales Ordria untuk upgrade ke paket dengan analitik lengkap.</p>
        </section>
        )}
        <div className="col-span-12 flex flex-col gap-6 xl:col-span-4">
          {fullOn ? (
          <section className="rounded-[12px] bg-cream p-5 ring-1 ring-[#e4e2dd]">
            <h2 className="mb-4 text-lg font-semibold">Best Selling</h2>
            {best.length === 0 ? (
              <p className="text-sm text-muted">Belum ada penjualan.</p>
            ) : (
              <ul className="space-y-3">
                {best.map((b, idx) => (
                  <li key={b.name}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sand text-xs font-bold">
                          {RANK_MEDAL[idx] ?? idx + 1}
                        </span>
                        <span className="truncate text-sm font-semibold">{b.name}</span>
                      </span>
                      <span className="shrink-0 text-xs font-bold text-sage">{b.qty}×</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sand">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sage to-[#4a7c59] transition-all"
                        style={{ width: `${Math.max(6, (b.qty / bestMax) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">{formatRupiah(b.revenue)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          ) : null}
          <section className="rounded-[12px] bg-[#f5f0e7] p-5">
            <h2 className="mb-2 text-sm font-semibold">Status Alerts</h2>
            {oos.length === 0 ? (
              <p className="text-sm text-muted">Semua menu tersedia.</p>
            ) : (
              oos.map((p) => (
                <p key={p.id} className="text-sm">
                  {p.name} — Out of Stock
                </p>
              ))
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
