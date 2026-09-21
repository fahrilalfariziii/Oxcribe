import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCafe } from '../../../mock/store'
import { api } from '../../../lib/api'
import { playShortConfirmBeep, unlockAudioOnGesture } from '../../../lib/sound'
import type { CartItem, Product } from '../../../shared/types'
import { formatRupiah } from '../../../shared/lib/format'
import { isFeatureOn } from '../../../shared/lib/features'
import { Button } from '../../../shared/components/ui'

export function ManualOrderPage() {
  const {
    products, categories, tables, placeOrder, business,
    refreshProductsFromBackend, refreshTablesFromBackend, refreshOrdersFromBackend,
  } = useCafe()
  const navigate = useNavigate()

  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [checkoutSaving, setCheckoutSaving] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null)

  // BE-first: katalog & meja asli agar ID sesuai DB (bukan seed basi)
  useEffect(() => {
    unlockAudioOnGesture()
    let cancelled = false
    setCatalogLoading(true)
    setCatalogError(null)
    Promise.all([refreshProductsFromBackend(), refreshTablesFromBackend()])
      .catch(() => {
        if (!cancelled) setCatalogError('Backend tidak terjangkau — memakai katalog lokal, simpan bisa gagal.')
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // State Cart & Filter
  const [cart, setCart] = useState<CartItem[]>([])
  const [cat, setCat] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')

  // State Popup 1: Opsi Varian/Addons
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({})

  // State Popup 2: Pembayaran
  const [isPayModalOpen, setIsPayModalOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [tableId, setTableId] = useState('')
  const enabledMethods = (business.enabledPaymentMethods as ('cash' | 'qris' | 'bank_transfer')[]) ?? ['cash', 'qris']
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'qris' | 'bank_transfer'>((enabledMethods[0] as 'cash' | 'qris' | 'bank_transfer') ?? 'cash')
  const [cashAmount, setCashAmount] = useState('')

  const tabs = ['All', ...categories.map((c) => c.name)]

  // Filter daftar menu berdasarkan kategori & pencarian
  const list = products.filter((p) => {
    const categoryName = categories.find((c) => c.id === p.categoryId)?.name
    const matchesCategory = cat === 'All' || categoryName === cat
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase())
    return p.isAvailable && matchesCategory && matchesSearch
  })

  // Hitung total harga item beserta harga varian/add-ons
  // Mendukung dua bentuk options: ItemSheet menyimpan addon sebagai { [name]: true },
  // Manual menyimpan { [type]: name }. Cek keduanya agar tidak undercharge.
  function calculateItemPrice(p: Product, options: Record<string, string>) {
    let optionTotal = 0
    if (p.options) {
      p.options.forEach((opt) => {
        if (options[opt.type] === opt.name || (options as Record<string, unknown>)[opt.name] === true) {
          optionTotal += opt.price
        }
      })
    }
    return p.price + optionTotal
  }

  // Kalkulasi Ringkasan Total — sinkron dengan placeOrder (PB1/service + bearer).
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0)
  const taxFeatureOn = isFeatureOn(business, 'taxFees')
  const serviceCharge = cart.length > 0 && isFeatureOn(business, 'serviceCharge') && business.serviceChargeEnabled
    ? (business.serviceChargeMode === 'flat'
      ? Math.max(0, Math.round(business.serviceChargeFlat))
      : Math.round(subtotal * (Math.min(100, Math.max(0, business.serviceChargeRate)) / 100)))
    : 0
  const taxBase = subtotal + serviceCharge
  const rawTax = cart.length > 0 && taxFeatureOn && business.taxEnabled ? Math.round(taxBase * (business.taxRate / 100)) : 0
  const tax = rawTax
  const total = taxFeatureOn && business.taxEnabled && business.taxBearer === 'cafe' ? subtotal + serviceCharge : subtotal + serviceCharge + tax

  // Hitung Kembalian Otomatis
  const changeAmount = useMemo(() => {
    const received = Number(cashAmount) || 0
    return Math.max(0, received - total)
  }, [cashAmount, total])

  // Handler Buka Modal Opsi Produk
  function handleSelectProduct(p: Product) {
    if (p.options && p.options.length > 0) {
      setSelectedProduct(p)
      setSelectedOptions({})
    } else {
      addCartItem(p, {}, '')
    }
  }

  // Handler Tambah ke Keranjang
  function addCartItem(p: Product, options: Record<string, string>, optionsLabel: string) {
    const finalPrice = calculateItemPrice(p, options)

    setCart((prev) => {
      const cartId = `${p.id}-${JSON.stringify(options)}`
      const found = prev.find((i) => i.cartId === cartId)
      if (found) {
        return prev.map((i) => (i.cartId === cartId ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [
        ...prev,
        {
          cartId,
          productId: p.id,
          name: p.name,
          price: finalPrice,
          quantity: 1,
          optionsLabel,
          options,
          imageUrl: p.imageUrl,
        },
      ]
    })
  }

  // Submit dari Modal Varian
  function handleAddFromOptionsModal() {
    if (!selectedProduct) return
    const labels = Object.values(selectedOptions).filter(Boolean).join(', ')
    addCartItem(selectedProduct, selectedOptions, labels)
    setSelectedProduct(null)
  }

  // Ubah Qty Keranjang
  function updateQty(cartId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => (i.cartId === cartId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0)
    )
  }

  // Submit Transaksi Akhir — BE-first recordOnly (tanpa Midtrans, status pending).
  // Varian layar {type:name} dipetakan ke selectedOptionIds BE agar total server = total layar.
  async function handleFinalCheckout() {
    if (cart.length === 0 || checkoutSaving) return
    // Nama pemesan wajib (semua metode)
    if (customerName.trim() === '') {
      setCheckoutError('Nama pemesan wajib diisi.')
      return
    }
    // Uang diterima wajib untuk cash (minimal sebesar total)
    const tendered = paymentMethod === 'cash'
      ? (cashAmount.trim() === '' ? undefined : Number(cashAmount))
      : undefined
    if (paymentMethod === 'cash') {
      if (tendered === undefined || !Number.isFinite(tendered)) {
        setCheckoutError('Uang diterima wajib diisi (angka).')
        return
      }
      if (tendered < total) {
        setCheckoutError('Uang diterima kurang dari total.')
        return
      }
    }
    setCheckoutSaving(true)
    setCheckoutError(null)
    setCheckoutNotice(null)
    try {
      const items = cart.map((c) => {
        const product = products.find((p) => p.id === c.productId)
        const selectedOptionIds: number[] = []
        if (product?.options) {
          for (const [type, name] of Object.entries(c.options ?? {})) {
            const match = product.options.find((o) => o.type === type && (o.name === name || (c.options as Record<string, unknown>)[o.name] === true))
            if (match) {
              const beOptId = Number(match.id)
              if (Number.isFinite(beOptId)) selectedOptionIds.push(beOptId)
            }
          }
        }
        return { productId: api.toBackendId(c.productId), quantity: c.quantity, selectedOptionIds }
      })
      const tableBeId = tableId ? api.toBackendId(tableId) : null
      await api.createPosOrder({
        customerName: customerName || 'Walk-in',
        tableId: tableBeId && tableBeId > 0 ? tableBeId : null,
        paymentMethod,
        recordOnly: true,
        tendered,
        items,
      })
      await refreshOrdersFromBackend().catch(() => {})
      setCart([])
      setCashAmount('')
      setCustomerName('')
      setIsPayModalOpen(false)
      // Tetap di halaman manual — kasir yang memilih pindah via banner/TOC
      setCheckoutNotice('Pesanan tersimpan — lihat di Live Orders.')
      if (business.soundEnabled) playShortConfirmBeep()
    } catch (e) {
      const status = (e as { status?: number })?.status
      if (status === undefined || status === 0) {
        // Server tak terjangkau (offline): simpan lokal sementara agar kasir tetap bisa jualan
        placeOrder({
          items: cart,
          customerName: customerName || 'Walk-in',
          tableId: tableId || null,
          tableNumber: tables.find((t) => t.id === tableId)?.tableNumber ?? 'Kasir',
          paymentMethod,
          source: 'pos',
          offline: true,
        })
        setCart([])
        setCashAmount('')
        setCustomerName('')
        setIsPayModalOpen(false)
        // Tetap di halaman manual meski offline
        setCheckoutNotice('Server tidak terjangkau — tersimpan lokal sementara (belum masuk Live Orders server).')
        if (business.soundEnabled) playShortConfirmBeep()
      } else {
        setCheckoutError(e instanceof Error ? e.message : 'Gagal menyimpan pesanan')
      }
    } finally {
      setCheckoutSaving(false)
    }
  }

  return (
    <div className="grid h-[calc(100vh-7rem)] grid-cols-[1fr_360px] gap-6">
      {/* Kolom Kiri: Katalog & Search */}
      <div className="flex flex-col">
        <h1 className="font-display mb-4 text-[32px] font-semibold">Manual POS</h1>
        {catalogLoading && (
          <p className="mb-3 text-xs text-stone">Memuat katalog dari server…</p>
        )}
        {catalogError && (
          <p className="mb-3 rounded-lg border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 px-3 py-2 text-xs font-medium text-[#ba1a1a]">{catalogError}</p>
        )}
        {checkoutNotice && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-sage/40 bg-[#b8cda9]/30 px-3 py-2 text-xs font-medium text-black">
            <span className="flex-1">{checkoutNotice}</span>
            <button
              type="button"
              onClick={() => navigate('/frontoffice/orders')}
              className="rounded-full bg-black px-3 py-1 text-[11px] font-bold text-white"
            >
              Lihat Live Orders
            </button>
          </div>
        )}

        {/* Baris Kategori & Input Search */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setCat(t)}
                className={`rounded-[12px] px-4 py-2 text-sm font-semibold transition-colors ${
                  t === cat ? 'bg-black text-white' : 'bg-sand text-stone hover:bg-[#e6e2d9] hover:text-black'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="relative min-w-[220px]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-stone">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari menu..."
              className="h-10 w-full rounded-[12px] border border-clay/60 bg-white pl-9 pr-3 text-sm outline-none focus:border-black transition-colors"
            />
          </div>
        </div>

        {/* Grid Katalog Produk */}
        <div className="grid grid-cols-2 gap-3 overflow-auto pr-1 xl:grid-cols-5">
          {list.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectProduct(p)}
              className="flex flex-col justify-between rounded-[12px] border border-[#c4c7c7] bg-cream p-3 text-left hover:border-black transition-all active:scale-[0.98]"
            >
              <div>
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="mb-2 h-28 w-full rounded-lg object-cover" />
                ) : (
                  <div className="mb-2 flex h-28 w-full items-center justify-center rounded-lg bg-sand font-display text-3xl text-stone">
                    {(p.name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <p className="font-semibold text-black">{p.name}</p>
              </div>
              <p className="mt-2 text-sm font-bold text-sage">{formatRupiah(p.price)}</p>
            </button>
          ))}

          {list.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-12 text-stone">
              <span className="material-symbols-outlined text-3xl">search_off</span>
              <p className="mt-1 text-sm font-medium">Menu tidak ditemukan.</p>
            </div>
          )}
        </div>
      </div>

      {/* Kolom Kanan: Ticket Pesanan (Model Kotak/Card Item) */}
      <aside className="flex flex-col justify-between rounded-[12px] border border-[#c4c7c7] bg-white p-5">
        <div className="flex flex-col h-full overflow-hidden">
          <h2 className="mb-4 font-semibold text-black">Ticket Pesanan</h2>

          {/* List Item Berbentuk Kotak */}
          <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
            {cart.map((i) => (
              <div
                key={i.cartId}
                className="flex items-center justify-between rounded-[10px] border border-clay/50 bg-cream p-3 text-sm shadow-2xs"
              >
                <div className="flex-1 pr-2">
                  <p className="font-bold text-black leading-tight">{i.name}</p>
                  {i.optionsLabel && (
                    <p className="mt-0.5 text-[11px] text-stone leading-tight">{i.optionsLabel}</p>
                  )}
                  <p className="mt-1 text-xs font-semibold text-sage">
                    {formatRupiah(i.price * i.quantity)}
                  </p>
                </div>

                {/* Counter Stepper */}
                <div className="flex items-center gap-2 rounded-lg bg-white border border-clay/40 px-2 py-1">
                  <button
                    onClick={() => updateQty(i.cartId, -1)}
                    className="flex size-5 items-center justify-center rounded-md font-bold text-black hover:bg-sand transition-colors"
                  >
                    -
                  </button>
                  <span className="w-4 text-center font-bold text-xs">{i.quantity}</span>
                  <button
                    onClick={() => updateQty(i.cartId, 1)}
                    className="flex size-5 items-center justify-center rounded-md bg-black font-bold text-white hover:bg-black/80 transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}

            {cart.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-stone border border-dashed border-clay/40 rounded-[10px]">
                <span className="material-symbols-outlined text-3xl mb-1">shopping_bag</span>
                <p className="text-xs font-medium">Belum ada item dipilih.</p>
              </div>
            )}
          </div>
        </div>

        {/* Ringkasan Total & Buka Popup Bayar */}
        <div className="mt-4 border-t border-sand pt-4">
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span>{formatRupiah(subtotal)}</span>
          </div>
          {business.serviceChargeEnabled && serviceCharge > 0 && (
            <div className="flex justify-between text-sm">
              <span>Service {business.serviceChargeMode === 'flat' ? '(flat)' : `${business.serviceChargeRate}%`}</span>
              <span>{formatRupiah(serviceCharge)}</span>
            </div>
          )}
          {business.taxEnabled && tax > 0 && (
            <div className="flex justify-between text-sm">
              <span>
                {business.taxLabel} {business.taxRate}% {business.taxBearer === 'cafe' ? '(ditanggung kafe)' : ''}
              </span>
              <span>{formatRupiah(tax)}</span>
            </div>
          )}
          <div className="my-2 flex justify-between text-lg font-bold text-black">
            <span>Total</span>
            <span className="text-sage">{formatRupiah(total)}</span>
          </div>

          <Button
            className="mt-3 w-full"
            disabled={cart.length === 0}
            onClick={() => setIsPayModalOpen(true)}
          >
            Lanjut ke Pembayaran
          </Button>
        </div>
      </aside>

      {/* POPUP 1: MODAL VARIAN & ADDONS */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-sand pb-3">
              <h3 className="font-semibold text-black">{selectedProduct.name}</h3>
              <button onClick={() => setSelectedProduct(null)} className="text-stone font-bold">✕</button>
            </div>

            <div className="my-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1 text-sm">
              {Array.from(new Set(selectedProduct.options?.map((o) => o.type))).map((type) => (
                <div key={type}>
                  <p className="mb-2 font-semibold uppercase text-stone text-xs tracking-wider">{type}</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedProduct.options
                      ?.filter((o) => o.type === type)
                      .map((opt) => {
                        const isSelected = selectedOptions[type] === opt.name
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setSelectedOptions((prev) => ({ ...prev, [type]: opt.name }))}
                            className={`rounded-lg border px-3 py-1.5 text-xs transition-all ${
                              isSelected
                                ? 'border-black bg-black font-semibold text-white'
                                : 'border-clay/60 bg-white text-black hover:border-black'
                            }`}
                          >
                            {opt.name} {opt.price > 0 && `(+${formatRupiah(opt.price)})`}
                          </button>
                        )
                      })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-sand pt-4">
              <div>
                <span className="text-xs text-stone">Total Harga Item</span>
                <p className="font-bold text-black">
                  {formatRupiah(calculateItemPrice(selectedProduct, selectedOptions))}
                </p>
              </div>
              <Button onClick={handleAddFromOptionsModal}>Tambah ke Ticket</Button>
            </div>
          </div>
        </div>
      )}

      {/* POPUP 2: MODAL PROSES PEMBAYARAN */}
      {isPayModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-sand pb-3">
              <h3 className="font-semibold text-black">Proses Pembayaran</h3>
              <button onClick={() => setIsPayModalOpen(false)} className="text-stone font-bold">✕</button>
            </div>

            <div className="my-4 space-y-4 text-sm">
              {/* Nama Pemesan */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-stone">Nama Pemesan</label>
                <input
                  type="text"
                  placeholder="Walk-in / Nama Pelanggan"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="h-10 w-full rounded-lg border border-clay px-3 outline-none focus:border-black"
                />
              </div>

              {/* Pilihan Meja */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-stone">Lokasi / Meja</label>
                <select
                  value={tableId}
                  onChange={(e) => setTableId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-clay px-3 outline-none focus:border-black"
                >
                  <option value="">Kasir / Takeaway</option>
                  {tables.filter((t) => t.isActive).map((t) => (
                    <option key={t.id} value={t.id}>
                      Meja {t.tableNumber}
                    </option>
                  ))}
                </select>
              </div>

                {/* Metode Pembayaran (record-only: dicatat, tanpa Midtrans) */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-stone">Metode Pembayaran (dicatat)</label>
                <div className="grid grid-cols-2 gap-2">
                  {enabledMethods.map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method as 'cash' | 'qris' | 'bank_transfer')}
                      className={`rounded-lg border py-2 text-xs font-bold uppercase transition-all ${
                        paymentMethod === method
                          ? 'border-black bg-black text-white'
                          : 'border-clay/60 bg-white text-stone hover:border-black'
                      }`}
                    >
                      {method === 'bank_transfer' ? 'VA' : method}
                    </button>
                  ))}
                </div>
                {enabledMethods.length === 0 && <p className="mt-2 text-xs text-[#ba1a1a]">Tidak ada metode aktif. Atur di BackOffice &gt; Pembayaran.</p>}
              </div>

              {/* Form Input Tunai (CASH) & Calculation */}
              {paymentMethod === 'cash' && (
                <div className="space-y-3 rounded-lg bg-cream p-3 border border-sand">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase text-stone">Uang Diterima</label>
                    <input
                      type="number"
                      placeholder="Nominal uang..."
                      value={cashAmount}
                      onChange={(e) => setCashAmount(e.target.value)}
                      className="h-10 w-full rounded-lg border border-clay px-3 text-sm font-semibold outline-none focus:border-black"
                    />
                  </div>
                  <div className="flex justify-between text-xs font-bold">
                    <span>Uang Kembalian</span>
                    <span className="text-sage">{formatRupiah(changeAmount)}</span>
                  </div>
                </div>
              )}

              {/* Rincian Total Tagihan */}
              <div className="flex justify-between border-t border-sand pt-3 text-base font-bold">
                <span>Total Tagihan</span>
                <span className="text-sage">{formatRupiah(total)}</span>
              </div>
              <p className="text-[11px] text-stone">Pesanan manual hanya dicatat (tanpa Midtrans) dengan status pending — lunasi via Tandai Lunas di Live Orders.</p>
            </div>

            {checkoutError && (
              <p className="mb-3 text-xs font-medium text-[#ba1a1a]">{checkoutError}</p>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setIsPayModalOpen(false)}>
                Batal
              </Button>
              <Button className="flex-1" disabled={checkoutSaving} onClick={handleFinalCheckout}>
                {checkoutSaving ? 'Menyimpan…' : 'Konfirmasi & Simpan'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}