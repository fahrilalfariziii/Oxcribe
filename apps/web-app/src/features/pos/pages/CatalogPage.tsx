import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCafe } from '../../../mock/store'
import type { Ingredient, Product } from '../../../shared/types'
import { subscribeStream } from '../../../lib/stream'

// Tahap 1 (tanpa tabel BOM): kaitkan menu↔bahan via kecocokan kata nama.
// Bukan kebenaran mutlak — hanya peringatan. Tahap 2 memakai tabel
// product_ingredients (pemetaan manual akurat) dan menggantikan fungsi ini.
const STOCK_STOPWORDS = new Set(['dan', 'dengan', 'untuk', 'dari', 'yang', 'ala', 'house', 'blend', 'fresh', 'premium'])

function tokensOf(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOCK_STOPWORDS.has(t))
}

type StockFlag = 'ok' | 'low' | 'out'

/** Status bahan terburuk yang namanya cocok dengan produk, atau 'ok' bila tak ada yang cocok. */
function stockFlagForProduct(p: Product, ingredients: Ingredient[]): { flag: StockFlag; names: string[] } {
  const hay = new Set(tokensOf(`${p.name} ${p.description ?? ''}`))
  let worst: StockFlag = 'ok'
  const names: string[] = []
  for (const ing of ingredients) {
    const toks = tokensOf(ing.name)
    if (toks.length === 0) continue
    const hit = toks.some((t) => hay.has(t)) || [...hay].some((t) => ing.name.toLowerCase().includes(t) && t.length >= 4)
    if (!hit) continue
    const oos = !ing.isAvailable || ing.currentStock <= 0
    const low = ing.currentStock <= ing.minimumStock
    if (oos) {
      worst = 'out'
      names.push(ing.name)
    } else if (low && worst === 'ok') {
      worst = 'low'
      names.push(ing.name)
    }
  }
  return { flag: worst, names }
}


export function CatalogPage() {
  const {
    products,
    categories,
    ingredients,
    toggleProductAvailability,
    refreshProductsFromBackend,
    refreshCategoriesFromBackend,
    refreshIngredientsFromBackend,
  } = useCafe()
  const [cat, setCat] = useState('All')
  const [q, setQ] = useState('')
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)
  const [confirm, setConfirm] = useState<Product | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // BE-first: muat katalog asli agar ID sesuai DB (cegah 404 ID basi p-1..p-7),
  // lalu dengarkan socket agar perubahan dari perangkat lain ikut masuk.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    Promise.all([refreshProductsFromBackend(), refreshCategoriesFromBackend(), refreshIngredientsFromBackend()])
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Gagal memuat katalog')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    let cleanup: (() => void) | undefined
    try {
      const token = localStorage.getItem('servopay_token') || undefined
      const handler = () => refreshProductsFromBackend().catch(() => {})
      const stockHandler = () => refreshIngredientsFromBackend().catch(() => {})
      cleanup = subscribeStream({
        token,
        handlers: { 'product:availability_updated': handler, 'ingredient:stock_updated': stockHandler },
      })
    } catch {
      // stream opsional — polling BE via refresh sudah cukup
    }
    return () => {
      cancelled = true
      if (cleanup) cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tabs = ['All', ...categories.map((c) => c.name)]

  const filtered = products.filter((p) => {
    const name = categories.find((c) => c.id === p.categoryId)?.name
    return (cat === 'All' || name === cat) && p.name.toLowerCase().includes(q.toLowerCase())
  })

  const stockSummary = useMemo(() => {
    const low = ingredients.filter((i) => i.isAvailable && i.currentStock > 0 && i.currentStock <= i.minimumStock)
    const out = ingredients.filter((i) => !i.isAvailable || i.currentStock <= 0)
    return { low, out }
  }, [ingredients])

  const stockFlags = useMemo(() => {
    const map = new Map<string, { flag: StockFlag; names: string[] }>()
    for (const p of products) map.set(p.id, stockFlagForProduct(p, ingredients))
    return map
  }, [products, ingredients])

  function showToast(msg: string, kind: 'success' | 'error') {
    setToast({ msg, kind })
    window.setTimeout(() => setToast(null), kind === 'error' ? 3500 : 2000)
  }

  async function handleConfirmToggle() {
    if (!confirm || pendingId) return
    const target = confirm
    const nextLabel = !target.isAvailable ? 'In Stock' : 'Out of Stock'
    setPendingId(target.id)
    try {
      await toggleProductAvailability(target.id)
      setConfirm(null)
      showToast(`${target.name} → ${nextLabel} — tersinkron ke self-order`, 'success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal menyimpan perubahan'
      showToast(`Gagal: ${msg}`, 'error')
      // ID basi (kasus 404 kemarin): refresh agar list kembali ke kebenaran server
      if (msg.includes('tidak ditemukan') || msg.includes('basi') || msg.includes('refresh')) {
        refreshProductsFromBackend().catch(() => {})
      }
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div>
      <h1 className="font-display text-[40px] font-semibold tracking-tight">Menu Availability</h1>
      <p className="mb-6 text-stone">Kelola ketersediaan item dan status katalog secara real-time.</p>

      {/* Baris Navigasi: Kategori (Kiri) & Search (Kanan, Sejajar) */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {/* Sisi Kiri: Tab Kategori */}
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setCat(t)}
              className={`h-[33px] rounded-[12px] px-4 text-xs font-semibold tracking-wider transition-colors ${
                t === cat ? 'bg-black text-white' : 'bg-sand text-stone hover:bg-[#e6e2d9] hover:text-black'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Sisi Kanan: Input Search (Terpisah & Sejajar) */}
        <div className="relative min-w-[240px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-stone">
            search
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari menu..."
            className="h-[34px] w-full rounded-[12px] border border-[#c4c7c7] bg-[#f7f3ea] pl-9 pr-4 text-sm outline-none focus:border-black transition-colors"
          />
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-[12px] border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 px-4 py-3 text-sm text-[#ba1a1a]">
          {loadError} — menampilkan data lokal. Cek backend di{' '}
          <span className="font-mono">http://localhost:4000</span> lalu refresh halaman.
        </div>
      )}

      {(stockSummary.out.length > 0 || stockSummary.low.length > 0) && (
        <Link
          to="/frontoffice/inventory"
          className="mb-4 flex items-center gap-3 rounded-[12px] border border-[#9a6b2f]/40 bg-[#f5e8c8] px-4 py-3 text-sm text-black transition-transform active:scale-[0.99]"
        >
          <span className="material-symbols-outlined text-[22px] text-[#9a6b2f]">warning</span>
          <span className="flex-1">
            {stockSummary.out.length > 0 && (
              <strong>{stockSummary.out.length} bahan habis{stockSummary.low.length > 0 ? ', ' : ''}</strong>
            )}
            {stockSummary.low.length > 0 && (
              <span><strong>{stockSummary.low.length} bahan menipis</strong></span>
            )}
            <span className="text-stone"> — cek Inventory. Menu terkait ditandai di bawah.</span>
          </span>
          <span className="text-xs font-bold text-stone">→</span>
        </Link>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-[12px] border border-[#c4c7c7] bg-[#ededed] p-4">
              <div className="size-20 rounded-lg bg-[#ededed]" />
              <div className="mt-3 h-4 w-2/3 rounded bg-[#ededed]" />
              <div className="mt-2 h-3 w-1/3 rounded bg-[#ededed]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          {filtered.map((p) => {
            const pending = pendingId === p.id
            const stock = stockFlags.get(p.id)
            return (
              <article key={p.id} className="flex gap-4 rounded-[12px] border border-[#c4c7c7] bg-[#ededed] p-4 items-center">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="size-20 rounded-lg object-cover" />
                ) : (
                  <div className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-white font-display text-2xl text-stone">
                    {(p.name || '?').charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="flex flex-1 items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-black leading-snug">{p.name}</p>
                    <p className="text-xs text-muted mt-0.5">{categories.find((c) => c.id === p.categoryId)?.name}</p>
                    <span
                      className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        p.isAvailable ? 'bg-[#b8cda9]/50 text-sage' : 'bg-[#ba1a1a]/15 text-[#ba1a1a]'
                      }`}
                    >
                      {p.isAvailable ? 'In Stock' : 'Out of Stock'}
                    </span>
                    {stock && stock.flag !== 'ok' && (
                      <span
                        title={`Bahan terkait: ${stock.names.join(', ')} (otomatis, tahap 1)`}
                        className={`ml-1 mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          stock.flag === 'out' ? 'bg-[#ba1a1a]/15 text-[#ba1a1a]' : 'bg-[#f5e8c8] text-[#9a6b2f]'
                        }`}
                      >
                        {stock.flag === 'out' ? '⚠ Bahan habis?' : '⚠ Bahan menipis?'}
                      </span>
                    )}
                  </div>

                  {/* TOGGLE SWITCH — buka popup konfirmasi dulu (1 per 1) */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.isAvailable}
                    disabled={pending}
                    onClick={() => setConfirm(p)}
                    title="Klik untuk ubah (minta konfirmasi)"
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-wait disabled:opacity-60 ${
                      p.isAvailable ? 'bg-sage' : 'bg-clay/60'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        p.isAvailable ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-lg ${
            toast.kind === 'error' ? 'bg-[#ba1a1a]' : 'bg-black'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Popup konfirmasi 1-per-1 ala ReceiptModal */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="absolute inset-0" onClick={() => (pendingId ? null : setConfirm(null))} />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-sm flex-col rounded-[16px] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-sand px-5 py-4">
              <h3 className="font-semibold text-black">Konfirmasi Perubahan</h3>
              <button
                onClick={() => setConfirm(null)}
                disabled={pendingId !== null}
                className="flex size-8 items-center justify-center rounded-full bg-sand text-stone hover:bg-[#e6e2d9] disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="flex items-center gap-3">
                {confirm.imageUrl ? (
                  <img src={confirm.imageUrl} alt="" className="size-14 rounded-lg object-cover" />
                ) : (
                  <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-sand font-display text-xl text-stone">
                    {(confirm.name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="font-semibold text-black">{confirm.name}</p>
                  <p className="text-xs text-muted">{categories.find((c) => c.id === confirm.categoryId)?.name}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider">
                <span
                  className={`rounded-full px-2 py-1 ${
                    confirm.isAvailable ? 'bg-[#b8cda9]/50 text-sage' : 'bg-[#ba1a1a]/15 text-[#ba1a1a]'
                  }`}
                >
                  {confirm.isAvailable ? 'In Stock' : 'Out of Stock'}
                </span>
                <span className="text-stone">→</span>
                <span
                  className={`rounded-full px-2 py-1 ${
                    !confirm.isAvailable ? 'bg-[#b8cda9]/50 text-sage' : 'bg-[#ba1a1a]/15 text-[#ba1a1a]'
                  }`}
                >
                  {!confirm.isAvailable ? 'In Stock' : 'Out of Stock'}
                </span>
              </div>
              <p className="mt-4 text-center text-xs text-stone">
                Perubahan langsung terlihat di self-order pelanggan.
              </p>
            </div>

            <div className="flex gap-3 border-t border-sand p-4">
              <button
                onClick={() => setConfirm(null)}
                disabled={pendingId !== null}
                className="flex-1 rounded-lg border border-clay py-2.5 text-xs font-semibold text-stone hover:bg-sand transition-colors disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmToggle}
                disabled={pendingId !== null}
                className="flex-1 rounded-lg bg-black py-2.5 text-xs font-semibold text-white hover:bg-black/80 transition-colors disabled:opacity-60"
              >
                {pendingId ? 'Menyimpan…' : 'Ya, Ubah'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
