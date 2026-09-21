import { useEffect, useRef, useState } from 'react'
import { useCafe } from '../../../mock/store'
import { formatRupiah, formatTime } from '../../../shared/lib/format'
import type { Order, OrderStatus } from '../../../shared/types'
import { ReceiptModal } from '../components/ReceiptModal'
import { api } from '../../../lib/api'
import { subscribeStream } from '../../../lib/stream'
import { notifyBrowserNewOrder, playNewOrderBeep, unlockAudioOnGesture } from '../../../lib/sound'

// Tab Kategori Pesanan Aktif
const CATEGORY_TABS: { id: OrderStatus; label: string; }[] = [
  { id: 'diterima', label: 'Diterima' },
  { id: 'diproses', label: 'Diproses' },
  { id: 'siap', label: 'Siap Diambil' },
]

export function OrdersPage() {
  const { orders, updateOrderStatus, markPaid, business, refreshOrdersFromBackend } = useCafe()
  const [activeTab, setActiveTab] = useState<OrderStatus>('diterima')
  const [selectedOrderForReceipt, setSelectedOrderForReceipt] = useState<Order | null>(null)
  const [newAlert, setNewAlert] = useState<{ orderNumber: string; table: string; customer: string } | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [checkingPayment, setCheckingPayment] = useState(false)
  const [historyDate, setHistoryDate] = useState(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
  const [historyHour, setHistoryHour] = useState<string>('all')
  const [historyQuery, setHistoryQuery] = useState('')
  const knownOrderIds = useRef<Set<string>>(new Set())
  const soundEnabledRef = useRef(business.soundEnabled)
  soundEnabledRef.current = business.soundEnabled
  const originalTitle = useRef<string | null>(null)

  // Daftarkan tiap order yang sudah dikenal agar hanya order BENAR-BARU yang bunyi
  useEffect(() => {
    orders.forEach((o) => knownOrderIds.current.add(o.id))
  }, [orders])

  // Toast + title tab untuk pesanan baru (otomatis hilang 6 detik)
  useEffect(() => {
    if (!newAlert) return
    if (originalTitle.current === null) originalTitle.current = document.title
    document.title = `🔔 Pesanan baru ${newAlert.orderNumber}`
    const t = window.setTimeout(() => {
      setNewAlert(null)
      if (originalTitle.current !== null) document.title = originalTitle.current
    }, 6000)
    return () => {
      window.clearTimeout(t)
      if (originalTitle.current !== null) document.title = originalTitle.current
    }
  }, [newAlert])

  // BE-first: fetch orders + socket realtime (fallback ke mock jika BE mati).
  // Suara HANYA dari event socket order:new (polling tidak bunyi → anti bunyi ganda).
  useEffect(() => {
    unlockAudioOnGesture()
    refreshOrdersFromBackend().catch(() => {})
    const iv = window.setInterval(() => refreshOrdersFromBackend().catch(() => {}), 8000)
    // SSE realtime
    let cleanup: (() => void) | undefined
    try {
      const onNew = (payload: unknown) => {
        refreshOrdersFromBackend().catch(() => {})
        const p = payload as {
          id?: number | string; orderNumber?: string; clientOrderId?: string;
          customerName?: string; tableNumber?: string | null;
          table?: { tableNumber?: string } | null
        } | null
        // Samakan format id FE ("o-<id>") agar cocok dengan knownOrderIds
        const feId = p && p.id !== undefined ? `o-${String(p.id).replace(/^o-/, '')}` : null
        if (!p || !feId || knownOrderIds.current.has(feId)) return
        knownOrderIds.current.add(feId)
        const table = p.tableNumber ?? p.table?.tableNumber ?? 'Kasir'
        setNewAlert({
          orderNumber: p.orderNumber ?? `#${feId}`,
          table,
          customer: p.customerName ?? 'Tamu',
        })
        if (soundEnabledRef.current) playNewOrderBeep()
        notifyBrowserNewOrder(
          `Pesanan baru ${p.orderNumber ?? ''}`,
          `Meja ${table} · ${p.customerName ?? 'Tamu'}`,
        )
      }
      const onUpd = () => refreshOrdersFromBackend().catch(() => {})
      cleanup = subscribeStream({
        token: localStorage.getItem('servopay_token') || undefined,
        handlers: { 'order:new': onNew, 'order:status_updated': onUpd, 'order:payment_updated': onUpd },
      })
    } catch {}
    return () => { window.clearInterval(iv); if (cleanup) cleanup() }
  }, [business.id, refreshOrdersFromBackend])

  const handleStatus = async (order: Order, status: OrderStatus) => {
    try {
      const beId = api.toBackendId(order.id)
      await api.updateOrderStatus(beId || order.id, status)
      updateOrderStatus(order.id, status)
    } catch {
      updateOrderStatus(order.id, status)
    }
  }
  const handleCancel = async (order: Order) => {
    if (order.paymentStatus === 'paid' || order.status === 'selesai' || order.status === 'batal') return
    if (!window.confirm(`Batalkan pesanan #${order.orderNumber}? Pesanan masuk ke riwayat.`)) return
    try {
      const beId = api.toBackendId(order.id)
      await api.cancelOrder(beId || order.id)
      updateOrderStatus(order.id, 'batal')
    } catch {
      updateOrderStatus(order.id, 'batal')
    }
  }
  const handlePaid = async (order: Order) => {
    // Hanya cash yang boleh ditandai manual — non-cash wajib via webhook DOKU.
    if (order.paymentMethod !== 'cash') return
    setPayError(null)
    setPayingId(order.id)
    try {
      const beId = api.toBackendId(order.id)
      await api.markOrderPaid(beId || order.id)
      markPaid(order.id)
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Gagal menandai lunas')
    } finally {
      setPayingId(null)
    }
  }

  const handleCheckPayment = async () => {
    setCheckingPayment(true)
    try {
      await refreshOrdersFromBackend()
    } finally {
      setCheckingPayment(false)
    }
  }

  // Filter riwayat (tab selesai): tanggal + jam mulai + nama pelanggan
  const todayId = (() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()
  const sameLocalDay = (iso: string, ymd: string) => {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return false
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === ymd
  }

  // Filter pesanan sesuai tab yang sedang aktif (+ filter riwayat bila di tab selesai).
  // Order batal keluar dari tab aktif dan tampil di Riwayat Transaksi.
  const filteredOrders = orders.filter((o) => {
    if (activeTab === 'selesai') {
      if (o.status !== 'selesai' && o.status !== 'batal') return false
      if (historyDate && !sameLocalDay(o.createdAt, historyDate)) return false
      if (historyHour !== 'all') {
        const h = new Date(o.createdAt).getHours()
        if (Number.isNaN(h) || h !== Number(historyHour)) return false
      }
      if (historyQuery && !o.customerName.toLowerCase().includes(historyQuery.trim().toLowerCase())) return false
      return true
    }
    if (o.status !== activeTab) return false
    return true
  })
  const historyFilterActive = activeTab === 'selesai' && (historyDate !== todayId || historyHour !== 'all' || historyQuery.trim() !== '')

  function resetHistoryFilter() {
    setHistoryDate(todayId)
    setHistoryHour('all')
    setHistoryQuery('')
  }

  // Hitung jumlah riwayat (selesai + batal) untuk badge tombol riwayat
  const completedCount = orders.filter((o) => o.status === 'selesai' || o.status === 'batal').length

  return (
    <div>
      <h1 className="font-display text-[40px] font-semibold tracking-tight">Live Orders</h1>
      <p className="mb-6 text-stone">Pesanan masuk real-time dari meja dan kasir.</p>

      {newAlert && (
        <button
          onClick={() => {
            setNewAlert(null)
            if (originalTitle.current !== null) document.title = originalTitle.current
          }}
          className="mb-4 flex w-full items-center gap-3 rounded-[12px] border border-sage/50 bg-[#b8cda9]/30 px-4 py-3 text-left shadow-xs transition-transform active:scale-[0.99]"
        >
          <span className="material-symbols-outlined animate-pulse text-[22px] text-sage">notifications_active</span>
          <span className="flex-1 text-sm text-black">
            <strong>Pesanan baru {newAlert.orderNumber}</strong>
            <span className="text-stone"> — Meja {newAlert.table} · {newAlert.customer}</span>
          </span>
          <span className="text-xs font-bold text-stone">✕</span>
        </button>
      )}

      {/* Baris Navigasi Utama: Terbagi Kiri (Kategori) & Kanan (Riwayat) */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[#c4c7c7] pb-4">
        {/* Sisi Kiri: Tab Kategori Status Pesanan Aktif */}
        <div className="flex flex-wrap items-center gap-3">
          {CATEGORY_TABS.map((tab) => {
            const count = orders.filter((o) => o.status === tab.id).length
            const isActive = activeTab === tab.id

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-[12px] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                  isActive
                    ? 'bg-black text-white shadow-md'
                    : 'bg-sand text-stone hover:bg-[#e6e2d9] hover:text-black'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-stone/20 text-stone'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Sisi Kanan: Button Riwayat Transaksi (Sejajar dengan Tab Kiri) */}
        <div>
          <button
            onClick={() => setActiveTab('selesai')}
            className={`flex items-center gap-2 rounded-[12px] border px-5 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              activeTab === 'selesai'
                ? 'border-black bg-black text-white shadow-md'
                : 'border-clay bg-white text-stone hover:border-black hover:text-black'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">history</span>
            <span>Riwayat Transaksi</span>
            <span
              className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                activeTab === 'selesai' ? 'bg-white/20 text-white' : 'bg-sand text-stone'
              }`}
            >
              {completedCount}
            </span>
          </button>
        </div>
      </div>

      {/* Filter Riwayat: hari + jam + nama pelanggan (hanya di tab selesai) */}
      {activeTab === 'selesai' && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[12px] border border-[#c4c7c7] bg-white p-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-stone">calendar_month</span>
            <input
              type="date"
              value={historyDate}
              onChange={(e) => setHistoryDate(e.target.value)}
              className="h-9 rounded-[8px] border border-clay bg-white pl-8 pr-2 text-xs outline-none focus:border-black"
              aria-label="Filter tanggal"
            />
          </div>
          <select
            value={historyHour}
            onChange={(e) => setHistoryHour(e.target.value)}
            className="h-9 rounded-[8px] border border-clay bg-white px-2 text-xs outline-none focus:border-black"
            aria-label="Filter jam"
          >
            <option value="all">Semua jam</option>
            {Array.from({ length: 24 }).map((_, h) => (
              <option key={h} value={String(h)}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
          <div className="relative min-w-[180px] flex-1">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-stone">search</span>
            <input
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="Cari nama pelanggan…"
              className="h-9 w-full rounded-[8px] border border-clay bg-white pl-8 pr-2 text-xs outline-none focus:border-black"
              aria-label="Cari nama pelanggan"
            />
          </div>
          {historyFilterActive && (
            <button
              onClick={resetHistoryFilter}
              className="flex h-9 items-center gap-1 rounded-[8px] border border-clay bg-white px-3 text-xs font-semibold text-stone hover:border-black hover:text-black"
            >
              <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              <span>Reset</span>
            </button>
          )}
          <span className="ml-auto text-[11px] text-stone">{filteredOrders.length} transaksi</span>
        </div>
      )}

      {/* Grid Utama Kartu Pesanan */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredOrders.map((order) => (
          <article
            key={order.id}
            className="flex flex-col justify-between rounded-[12px] border border-[#c4c7c7] bg-cream p-4 shadow-xs"
          >
            <div>
              <div className="flex items-start justify-between border-b border-sand pb-3">
                <div>
                  <p className="text-sm font-bold text-black">#{order.orderNumber}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {order.tableNumber ? `Meja ${order.tableNumber}` : 'Kasir'} · {order.customerName}
                  </p>
                  <p className="text-[11px] text-stone">{formatTime(order.createdAt)}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${order.status === 'batal' ? 'bg-[#ba1a1a]/10 text-[#ba1a1a]' : 'bg-sand text-stone'}`}>
                  {order.status === 'batal' ? `dibatalkan · ${order.paymentStatus}` : `${order.paymentMethod} · ${order.paymentStatus}`}
                </span>
              </div>

              <ul className="my-3 space-y-1 text-sm">
                {order.items.map((it) => (
                  <li key={it.id} className="flex justify-between">
                    <span>
                      <strong className="font-semibold">{it.quantity}×</strong> {it.productName}
                      {it.optionsLabel ? <span className="block text-xs text-muted">{it.optionsLabel}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 border-t border-sand pt-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-muted">Total</span>
                <span className="font-semibold text-black">{formatRupiah(order.total)}</span>
              </div>

              <div className="flex flex-col gap-2">
                {payError && payingId === order.id && (
                  <p className="rounded-lg border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 px-3 py-2 text-[11px] font-medium text-[#ba1a1a]">{payError}</p>
                )}
                {/* Non-cash pending: animasi menunggu pembayaran pelanggan (tanpa tombol lunas) */}
                {order.paymentStatus !== 'paid' && order.paymentMethod !== 'cash' && activeTab !== 'selesai' && (
                  <div className="flex items-center gap-2 rounded-lg border border-sand bg-cream px-3 py-2">
                    <span className="material-symbols-outlined animate-spin text-[18px] text-sage">progress_activity</span>
                    <span className="flex-1 text-[11px] font-medium text-stone">Menunggu pembayaran pelanggan…</span>
                    <button
                      type="button"
                      onClick={handleCheckPayment}
                      disabled={checkingPayment}
                      className="rounded-full border border-clay bg-white px-2.5 py-1 text-[10px] font-bold text-stone hover:border-black hover:text-black disabled:opacity-60"
                    >
                      {checkingPayment ? 'Mengecek…' : 'Cek status'}
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  {order.paymentStatus !== 'paid' && order.paymentMethod === 'cash' && activeTab !== 'selesai' && (
                    <button
                      className="flex-1 rounded-lg bg-sand px-3 py-2 text-xs font-semibold text-black hover:bg-[#e6e2d9] transition-colors disabled:opacity-60"
                      disabled={payingId === order.id}
                      onClick={() => handlePaid(order)}
                    >
                      {payingId === order.id ? 'Menyimpan…' : 'Tandai Lunas'}
                    </button>
                  )}

                  {/* Proses hanya muncul bila pembayaran sudah selesai */}
                  {activeTab === 'diterima' && order.paymentStatus === 'paid' && (
                    <button
                      className="flex-1 rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-black/80 transition-colors"
                      onClick={() => handleStatus(order, 'diproses')}
                    >
                      Proses
                    </button>
                  )}

                  {/* Batalkan pesanan yang belum lunas (masuk riwayat) */}
                  {activeTab === 'diterima' && order.paymentStatus !== 'paid' && (
                    <button
                      className="flex-1 rounded-lg border border-[#ba1a1a]/40 bg-white px-3 py-2 text-xs font-semibold text-[#ba1a1a] hover:bg-[#ba1a1a]/10 transition-colors"
                      onClick={() => handleCancel(order)}
                    >
                      Batalkan
                    </button>
                  )}

                  {activeTab === 'diproses' && (
                    <button
                      className="flex-1 rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-black/80 transition-colors"
                      onClick={() => handleStatus(order, 'siap')}
                    >
                      Siap
                    </button>
                  )}

                  {activeTab === 'siap' && (
                    <button
                      className="flex-1 rounded-lg bg-sage px-3 py-2 text-xs font-semibold text-white hover:bg-sage/90 transition-colors"
                      onClick={() => handleStatus(order, 'selesai')}
                    >
                      Selesai
                    </button>
                  )}
                </div>

                {/* Tombol Cetak Struk (Muncul di Diterima dan Riwayat Transaksi) */}
                {(activeTab === 'diterima' || activeTab === 'selesai') && (
                  <button
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-clay bg-white py-2 text-xs font-semibold text-stone hover:border-black hover:text-black transition-colors"
                    onClick={() => setSelectedOrderForReceipt(order)}
                  >
                    <span className="material-symbols-outlined text-[16px]">print</span>
                    <span>Cetak Struk</span>
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Empty State jika tidak ada data */}
      {filteredOrders.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-[#c4c7c7] py-16 text-center">
          <span className="material-symbols-outlined mb-2 text-4xl text-stone">
            {activeTab === 'selesai' ? 'history' : 'inbox'}
          </span>
          <p className="text-sm font-medium text-stone">
            {activeTab === 'selesai'
              ? historyFilterActive
                ? 'Tidak ada transaksi pada filter ini.'
                : 'Belum ada riwayat transaksi yang selesai.'
              : `Tidak ada pesanan dalam status "${
                  CATEGORY_TABS.find((t) => t.id === activeTab)?.label
                }".`}
          </p>
        </div>
      )}

      {/* Modal Popup Struk */}
      {selectedOrderForReceipt && (
        <ReceiptModal
          order={selectedOrderForReceipt}
          onClose={() => setSelectedOrderForReceipt(null)}
        />
      )}
    </div>
  )
}