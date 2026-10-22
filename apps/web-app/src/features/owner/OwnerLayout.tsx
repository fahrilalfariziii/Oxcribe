import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useCafe } from '../../mock/store'
import { OwnerSidebar } from './components/OwnerSidebar'
import { subscribeStream } from '../../lib/stream'

export function OwnerLayout() {
  const {
    refreshBusinessFromBackend,
    refreshOrdersFromBackend,
    refreshProductsFromBackend,
    refreshCategoriesFromBackend,
    refreshStaffFromBackend,
    refreshTablesFromBackend,
    refreshIngredientsFromBackend,
  } = useCafe()
  const [loadError, setLoadError] = useState<string | null>(null)

  // Refresh terpusat area owner: semua halaman baca data server, bukan seed.
  // Laporan (dashboard/omset/riwayat) otomatis = transaksi asli.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      refreshBusinessFromBackend(),
      refreshOrdersFromBackend(),
      refreshProductsFromBackend(),
      refreshCategoriesFromBackend(),
      refreshStaffFromBackend(),
      refreshTablesFromBackend(),
      refreshIngredientsFromBackend(),
    ]).catch(() => {
      if (!cancelled) setLoadError('Backend tidak terjangkau — menampilkan data lokal.')
    })
    let cleanup: (() => void) | undefined
    try {
      const token = localStorage.getItem('servopay_token') || undefined
      const refreshOrders = () => refreshOrdersFromBackend().catch(() => {})
      const refreshProducts = () => {
        refreshProductsFromBackend().catch(() => {})
        refreshCategoriesFromBackend().catch(() => {})
      }
      const refreshStock = () => refreshIngredientsFromBackend().catch(() => {})
      const refreshBiz = () => refreshBusinessFromBackend().catch(() => {})
      cleanup = subscribeStream({
        token,
        handlers: {
          'order:new': refreshOrders,
          'order:status_updated': refreshOrders,
          'order:payment_updated': refreshOrders,
          'product:availability_updated': refreshProducts,
          'ingredient:stock_updated': refreshStock,
          'business:cash_updated': refreshBiz,
          'business:updated': refreshBiz,
        },
      })
    } catch {}
    return () => {
      cancelled = true
      if (cleanup) cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-white text-black">
      {/* Navbar Samping (Sidebar) Terpisah */}
      <OwnerSidebar />

      {/* Area Konten Utama Halaman Owner */}
      <main className="flex-1 overflow-y-auto p-8">
        {loadError && (
          <p className="mb-4 rounded-[12px] border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 px-4 py-3 text-sm text-[#ba1a1a]">
            {loadError}
          </p>
        )}
        <Outlet />
      </main>
    </div>
  )
}

export function OwnerSettingsPage() {
  return <Outlet />
}