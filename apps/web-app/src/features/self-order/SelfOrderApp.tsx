import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  clearOrderSessionStorage,
  clearStaleOrderStorage,
  isOrderNotFoundError,
  readOrderSession,
  removeFromOrderHistory,
  useCafe,
} from '../../mock/store'
import type { OrderOwner } from '../../mock/store'
import { formatRupiah } from '../../shared/lib/format'
import { selfOrderPaymentMethods } from '../../shared/lib/payment-policy'
import { api } from '../../lib/api'
import { normalizeTheme } from '../../shared/types'
import type { CartItem, PaymentMethod, Product } from '../../shared/types'
import { CartScreen } from './screens/CartScreen'
import { MenuScreen } from './screens/MenuScreen'
import { PaymentScreen } from './screens/PaymentScreen'
import { StatusScreen } from './screens/StatusScreen'
import { ItemSheet } from './components/ItemSheet'
import { BottomNav } from './components/BottomNav'
import { OrderSkeleton } from './components/OrderSkeleton'
import { subscribeStream } from '../../lib/stream'

type Screen = 'menu' | 'cart' | 'payment' | 'status' | 'history'

export function SelfOrderApp() {
  const { token } = useParams()
  const { tables, products, placeOrder, createRealOrder, fetchCatalogFromBackend, refreshOrderFromBackend, rechargeOrderFromBackend, cancelOrderFromBackend, restoreOrderHistory, orders, business } = useCafe()
  const theme = normalizeTheme(business.theme)
  const titleFont = theme.titleFont === 'sans' ? 'font-sans' : theme.titleFont === 'serif' ? 'font-serif' : 'font-display'
  const STORAGE_KEY = 'servopay:activeOrder'
  // Validasi meja ke server: resolve sukses -> info meja server; gagal (404/inaktif)
  // -> invalid; error jaringan -> unknown (fallback tabel lokal agar offline tetap jalan).
  const [serverTable, setServerTable] = useState<{ tableNumber: string; tableId: number } | null>(null)
  const [tableInvalid, setTableInvalid] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(Boolean(token))
  const [catalogRetry, setCatalogRetry] = useState(0)
  // BE-first: fetch catalog/business via qrToken + realtime product availability
  useEffect(() => {
    if (!token) return
    let cancelled = false
    setCatalogLoading(true)
    fetchCatalogFromBackend(token).then((info) => {
      if (cancelled) return
      if (info) {
        setServerTable(info)
        setTableInvalid(false)
      } else {
        // Gagal resolve: bedakan 404 (meja salah/nonaktif) vs jaringan via cek langsung
        return api.resolveTable(token).then(
          () => {
            if (!cancelled) setTableInvalid(false)
          },
          (e: unknown) => {
            if (cancelled) return
            const status = (e as { status?: number })?.status
            if (status === 404 || /tidak valid|tidak aktif|not found/i.test(e instanceof Error ? e.message : '')) {
              setTableInvalid(true)
            }
          },
        )
      }
    }).catch(() => {}).finally(() => { if (!cancelled) setCatalogLoading(false) })
    return () => {
      cancelled = true
    }
  }, [token, fetchCatalogFromBackend, catalogRetry])
  // Realtime katalog: socket product:availability_updated + business:updated + polling 12s
  useEffect(() => {
    if (!token) return
    let iv: number | undefined
    const poll = () => {
      fetchCatalogFromBackend(token).then((info) => {
        if (info) {
          setServerTable(info)
          setTableInvalid(false)
        }
      }).catch(() => {})
    }
    iv = window.setTimeout(() => { poll(); iv = window.setInterval(poll, 12000) as unknown as number }, 5000) as unknown as number
    // Realtime katalog via SSE (sama seperti OrdersPage join)
    let cleanup: (() => void) | undefined
    try {
      const handler = () => {
        fetchCatalogFromBackend(token).then((info) => {
          if (info) {
            setServerTable(info)
            setTableInvalid(false)
          }
        }).catch(() => {})
      }
      cleanup = subscribeStream({
        qrToken: token,
        handlers: { 'product:availability_updated': handler, 'business:updated': handler },
      })
    } catch {}
    return () => { if (iv) window.clearInterval(iv); if (cleanup) cleanup() }
  }, [token, fetchCatalogFromBackend])
  // Fallback ke meja 04 hanya jika token tidak ada (mis. akses langsung /order tanpa token).
  // Jika token ada tapi server nyatakan invalid -> "Meja tidak ditemukan".
  // Jika server valid tapi tabel lokal belum sinkron -> pakai info server.
  const fallbackTable = tables.find((t) => t.tableNumber === '04')
  const tableByToken = token ? tables.find((t) => t.qrToken === token && t.isActive) : undefined
  const serverTableAsLocal = token && serverTable
    ? { id: `t-${serverTable.tableId}`, tableNumber: serverTable.tableNumber, qrToken: token, isActive: true }
    : null
  const table = !token
    ? (fallbackTable ?? null)
    : tableInvalid
      ? null
      : (tableByToken ?? serverTableAsLocal ?? null)
  const [screen, setScreen] = useState<Screen>('menu')
  const [cart, setCart] = useState<CartItem[]>([])
  const [addedItem, setAddedItem] = useState<{ sequence: number; name: string; quantity: number } | null>(null)
  const addedSequence = useRef(0)
  const [restoringOrder, setRestoringOrder] = useState(false)
  const [staleStatusFor, setStaleStatusFor] = useState<string | null>(null)
  const restoredSession = useRef(false)
  const confirmPayment = useCallback(() => setScreen('status'), [])
  const checkoutInFlight = useRef(false)
  const [checkoutPending, setCheckoutPending] = useState(false)
  const [popup, setPopup] = useState<Product | null>(null)
  const [customerName, setCustomerName] = useState('')
  const enabledMethods = selfOrderPaymentMethods(business.enabledPaymentMethods)
  const [payMethod, setPayMethod] = useState<PaymentMethod>(enabledMethods[0] ?? 'cash')
  const [activeOrderId, setActiveOrderId] = useState<string | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { activeOrderId?: string; screen?: string }
        if (parsed?.activeOrderId) return parsed.activeOrderId
      }
    } catch {}
    return null
  })
  const [orderNotice, setOrderNotice] = useState<string | null>(null)
  const notFoundCount = useRef(0)
  // Riwayat milik sesi (nama+meja) ini — dipulihkan dari server saat mount/refresh
  const [historyIds, setHistoryIds] = useState<string[]>(() => readOrderSession().clientOrderIds)
  const [historyOwner, setHistoryOwner] = useState<OrderOwner | null>(() => readOrderSession().owner)

  function handleStaleOrder() {
    clearStaleOrderStorage()
    setActiveOrderId(null)
    setScreen('menu')
    setOrderNotice('Pesanan sebelumnya tidak ditemukan di server (mungkin data di-reset). Silakan pesan ulang.')
  }

  // Order basi dari sesi: buang dari riwayat juga agar daftar bersih
  function handleStaleHistoryOrder(clientOrderId: string) {
    removeFromOrderHistory(clientOrderId)
    setHistoryIds((prev) => prev.filter((id) => id !== clientOrderId))
  }

  // Tutup sesi pelanggan: bersihkan semua jejak di HP ini (untuk pelanggan berikutnya)
  function handleEndSession() {
    localStorage.removeItem('servopay:checkoutAttempt')
    clearOrderSessionStorage()
    setActiveOrderId(null)
    setHistoryIds([])
    setHistoryOwner(null)
    setCustomerName('')
    setCart([])
    setAddedItem(null)
    setScreen('menu')
  }

  useEffect(() => {
    if (!enabledMethods.some((method) => method === payMethod) && enabledMethods.length > 0) {
      setPayMethod(enabledMethods[0])
    }
  }, [enabledMethods.join(','), payMethod])

  const activeOrder = orders.find((o) => o.id === activeOrderId) ?? null

  // Pulihkan pesanan server yang sama setelah halaman dimuat ulang.
  useEffect(() => {
    if (!restoredSession.current) return
    try {
      const active = orders.find((o) => o.id === activeOrderId)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeOrderId, clientOrderId: active?.clientOrderId, screen, customerName }))
    } catch {}
  }, [activeOrderId, screen, customerName, orders])

  // Rehydrate dari localStorage saat mount (jika refresh saat di status/payment)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      restoredSession.current = true
      if (!raw) return
      const parsed = JSON.parse(raw) as { activeOrderId?: string; clientOrderId?: string; screen?: string; customerName?: string }
      if (parsed?.customerName && !customerName) setCustomerName(parsed.customerName)
      if (parsed?.screen === 'status' || parsed?.screen === 'payment') {
        setScreen(parsed.screen as typeof screen)
      }
      const storedClientId = parsed?.clientOrderId || localStorage.getItem('servopay:activeClientOrderId')
      if (storedClientId && !activeOrder) {
        setRestoringOrder(true)
        refreshOrderFromBackend(storedClientId).then((updated) => {
          if (updated) {
            notFoundCount.current = 0
            setActiveOrderId(updated.id)
          }
        }).catch((e: unknown) => {
          // Order basi (DB di-seed ulang / tidak pernah ada di BE): buang + kembali ke menu
          if (isOrderNotFoundError(e)) handleStaleOrder()
        }).finally(() => setRestoringOrder(false))
      } else if (parsed?.activeOrderId && !activeOrder) {
        const found = orders.find((o) => o.id === parsed.activeOrderId)
        if (!found && storedClientId) {
          refreshOrderFromBackend(storedClientId).then((u) => {
            if (u) {
              notFoundCount.current = 0
              setActiveOrderId(u.id)
            }
          }).catch((e: unknown) => {
            if (isOrderNotFoundError(e)) handleStaleOrder()
          })
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Realtime status tracking: socket + polling fallback 5s (untuk StatusScreen).
  // Hanya untuk order asli BE (id "o-…"). Order mock lokal (id "ord-…", fallback
  // offline) memang tidak ada di server — polling-nya hanya spam 404.
  // Setelah 2x 404 beruntun, order dianggap basi: stop polling + buang storage + notice.
  useEffect(() => {
    if (!activeOrder || !token) return
    if (!activeOrder.id.startsWith('o-')) return
    let iv: number | undefined
    let cancelled = false
    let inFlight = false
    const refresh = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const updated = await refreshOrderFromBackend(activeOrder.clientOrderId)
        if (!cancelled) {
          setStaleStatusFor(updated ? null : activeOrder.id)
          if (updated) notFoundCount.current = 0
        }
      } catch (e) {
        if (!cancelled) setStaleStatusFor(activeOrder.id)
        if (isOrderNotFoundError(e) && !cancelled) {
          notFoundCount.current += 1
          if (notFoundCount.current >= 2) {
            cancelled = true
            if (iv) window.clearInterval(iv)
            handleStaleHistoryOrder(activeOrder.clientOrderId)
            handleStaleOrder()
            return
          }
        }
      } finally { inFlight = false }
    }
    const poll = async () => {
      await refresh()
      if (!cancelled) iv = window.setTimeout(poll, 5000) as unknown as number
    }
    iv = window.setTimeout(poll, 3000) as unknown as number
    let cleanup: (() => void) | undefined
    try {
      const handler = (payload: unknown) => {
        const p = payload as { clientOrderId?: string } | null
        if (p?.clientOrderId === activeOrder.clientOrderId) void refresh()
      }
      cleanup = subscribeStream({
        qrToken: token,
        clientOrderId: activeOrder.clientOrderId,
        handlers: { 'order:status_updated': handler, 'order:payment_updated': handler },
      })
    } catch {}
    return () => { cancelled = true; if (iv) window.clearInterval(iv); if (cleanup) cleanup() }
  }, [activeOrder?.id, activeOrder?.clientOrderId, token, refreshOrderFromBackend])

  function addToCart(item: Product, optionsLabel: string, options: CartItem['options'], unitPrice: number, qty: number) {
    localStorage.removeItem('servopay:checkoutAttempt')
    setCart((prev) => [
      ...prev,
      {
        cartId: `${item.id}-${Date.now()}`,
        productId: item.id,
        name: item.name,
        price: unitPrice,
        quantity: qty,
        optionsLabel,
        options,
        imageUrl: item.imageUrl,
      },
    ])
    setPopup(null)
    setAddedItem({ sequence: ++addedSequence.current, name: item.name, quantity: qty })
    navigator.vibrate?.(18)
  }

  function updateQty(cartId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => (i.cartId === cartId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0),
    )
  }

  async function checkout() {
    if (checkoutInFlight.current) return
    checkoutInFlight.current = true
    setCheckoutPending(true)
    try { await performCheckout() }
    finally { checkoutInFlight.current = false; setCheckoutPending(false) }
  }

  async function performCheckout() {
    if (!enabledMethods.some((method) => method === payMethod)) {
      setOrderNotice('Pilih metode pembayaran yang tersedia.')
      return
    }
    let order: ReturnType<typeof placeOrder> | null = null
    if (token) {
      try {
        const beOrder = await createRealOrder({
          qrToken: token,
          customerName: customerName || 'Tamu',
          paymentMethod: payMethod,
          items: cart.map((c) => ({
            productId: c.productId,
            quantity: c.quantity,
            selectedOptionIds: (products.find((product) => product.id === c.productId)?.options ?? [])
              .filter((option) => c.options?.[option.type] === option.name || c.options?.[option.name] === true)
              .map((option) => Number(option.id))
              .filter((id) => Number.isSafeInteger(id) && id > 0),
          })),
        } as unknown as Parameters<typeof createRealOrder>[0])
        if (beOrder) order = beOrder
      } catch (error) {
        setOrderNotice(error instanceof Error ? error.message : 'Server tidak terjangkau. Pesanan belum dikonfirmasi. Cek riwayat sebelum mencoba kembali.')
        return
      }
    }
    if (!order) {
      if (import.meta.env.PROD) {
        setOrderNotice('Pesanan belum dikonfirmasi server. Hubungi kasir atau coba kembali setelah koneksi pulih.')
        return
      }
      order = placeOrder({
        items: cart,
        customerName,
        tableId: table?.id ?? null,
        tableNumber: table?.tableNumber ?? null,
        paymentMethod: payMethod,
        source: 'self_order',
      })
    }
    setActiveOrderId(order.id)
    // Keranjang dipertahankan agar pelanggan bisa kembali (Pilih Metode Lain)
    // dan ganti metode bayar setelah pesanan lama dibatalkan.
    notFoundCount.current = 0
    setOrderNotice(null)
    // Sinkronkan riwayat sesi (nama berbeda = pelanggan baru -> riwayat lama sudah dibuang store)
    if (token) {
      const sess = readOrderSession()
      setHistoryIds(sess.clientOrderIds)
      setHistoryOwner(sess.owner)
    }

    if (payMethod !== 'cash') setScreen('payment')
    else setScreen('status')
  }

  // Pulihkan riwayat sesi (nama+meja) ini dari server — refresh tidak menghilangkan
  useEffect(() => {
    if (!token) return
    let cancelled = false
    restoreOrderHistory(token).then(({ orders: restored, owner }) => {
      if (cancelled) return
      setHistoryOwner(owner)
      if (restored.length > 0) {
        setHistoryIds(restored.map((o) => o.clientOrderId))
      }
    }).catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const historyOrders = historyIds
    .map((id) => orders.find((o) => o.clientOrderId === id))
    .filter((o): o is NonNullable<typeof o> => Boolean(o))

  // Helper navigasi untuk tab Pesanan di seluruh layar
  const handleGoOrderTab = () => {
    if (activeOrder) {
      setScreen('status')
    } else if (historyIds.length > 0) {
      setScreen('history')
    } else {
      setScreen('cart')
    }
  }

  if (catalogLoading && !serverTable) {
    return <OrderSkeleton label="Memuat menu…" menu />
  }

  if (!table) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-paper px-6 text-center">
        <p className="text-soil">{tableInvalid ? 'QR meja tidak aktif. Minta bantuan kasir.' : 'Menu belum bisa dimuat. Periksa koneksi lalu coba lagi.'}</p>
        {!tableInvalid && <button type="button" className="min-h-11 rounded-lg bg-ink px-4 font-semibold text-white" onClick={() => setCatalogRetry((value) => value + 1)}>Muat ulang menu</button>}
      </div>
    )
  }

  // Kill-switch selfOrder: paket tanpa self-order (Starter) tidak bisa pesan via QR.
  // Fail-open bila key hilang (tenant lama pra-kanon tetap bisa pesan).
  const selfOrderOn = business.features ? business.features.selfOrder !== false : true
  if (!selfOrderOn) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-paper px-6 text-center">
        <div className="max-w-sm">
          <p className="font-display text-2xl font-bold">{business.name}</p>
          <p className="mt-2 text-sm text-soil">Pemesanan via QR tidak tersedia pada paket kafe ini. Silakan pesan langsung di kasir.</p>
          <p className="mt-1 text-xs text-soil">Meja {table.tableNumber}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh w-full justify-center bg-paper sm:bg-[#d0ccc8] sm:p-4">
      <div className="self-order relative flex min-h-0 w-full max-w-md flex-col overflow-hidden shadow-xl sm:rounded-2xl" style={{ background: theme.pageBg }}>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {orderNotice && (
            <div role="alert" className="mx-4 mt-3 flex shrink-0 items-center justify-between gap-2 rounded-xl border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 px-3 text-xs font-medium text-[#ba1a1a]">
              <span>{orderNotice}</span>
              <button
                onClick={() => setOrderNotice(null)}
                className="size-11 shrink-0 font-bold"
                aria-label="Tutup notifikasi"
              >
                ✕
              </button>
            </div>
          )}
          <div hidden={screen !== 'menu'} className="self-order-screen min-h-0 flex-1">
            <MenuScreen
              tableNumber={table.tableNumber}
              products={products}
              cart={cart}
              addedItem={addedItem}
              visible={screen === 'menu'}
              onSelectItem={setPopup}
              onGoCart={() => setScreen('cart')}
            />
          </div>
          {screen !== 'menu' && <div key={screen} className="self-order-screen min-h-0 flex-1">
          {screen === 'cart' && (
            <CartScreen
              tableNumber={table.tableNumber}
              cart={cart}
              customerName={customerName}
              payMethod={payMethod}
              onName={setCustomerName}
              onPayMethod={setPayMethod}
              onBack={() => setScreen('menu')}
              onUpdateQty={updateQty}
              onCheckout={checkout}
              checkoutPending={checkoutPending}
            />
          )}
          {screen === 'payment' && activeOrder && (
            <PaymentScreen
              order={activeOrder}
              onBack={() => setScreen('cart')}
              onConfirm={confirmPayment}
              onChangeMethod={async () => {
                // Batalkan order lama di server,
                // lalu kembali — checkout berikutnya = order baru.
                if (!activeOrder.id.startsWith('o-')) {
                  setScreen('cart')
                  return
                }
                const updated = await cancelOrderFromBackend(activeOrder.clientOrderId)
                if (!updated) throw new Error('Gagal membatalkan pesanan di server')
                localStorage.removeItem('servopay:checkoutAttempt')
                setScreen('cart')
              }}
              onRetry={async () => {
                // Hanya order BE yang bisa recharge (mock lokal tidak ada di server)
                if (!activeOrder.id.startsWith('o-')) throw new Error('Pesanan lokal belum tersinkron ke server')
                const updated = await rechargeOrderFromBackend(
                  activeOrder.clientOrderId,
                )
                if (!updated) throw new Error('Server tidak mengembalikan order baru')
              }}
            />
          )}
          {screen === 'status' && activeOrder && (
            <StatusScreen
              order={activeOrder}
              cart={cart}
              tableNumber={table.tableNumber}
              onOrderAgain={() => {
                setCart([])
                setAddedItem(null)
                localStorage.removeItem('servopay:checkoutAttempt')
                setScreen('menu')
              }}
              onOpenHistory={() => setScreen('history')}
              onEndSession={handleEndSession}
            />
          )}
          {(screen === 'payment' || screen === 'status') && !activeOrder && (
            restoringOrder ? <OrderSkeleton label="Memuat status pesanan…" /> : (
              <div className="px-5 py-8 text-soil">
                <p role="status">Status pesanan belum tersedia.</p>
                <button type="button" onClick={handleGoOrderTab} className="mt-3 min-h-11 rounded-lg border border-clay px-4 font-semibold">Buka pesanan</button>
              </div>
            )
          )}
          {screen === 'history' && (
            <div className="flex h-full flex-col px-5 pb-24 pt-6">
              <h2 className={`text-2xl font-bold ${titleFont}`}>Riwayat Pesanan</h2>
              {historyOwner && (
                <p className="mt-1 text-xs text-soil">
                  Sesi: <strong className="text-black">{historyOwner.customerName}</strong>
                  {' · '}Meja {table.tableNumber}
                </p>
              )}
              <div className="mt-4 flex-1 space-y-3 overflow-y-auto scrollbar-hide">
                {historyOrders.length === 0 && (
                  <p className="py-8 text-center text-sm text-soil">Belum ada pesanan pada sesi ini.</p>
                )}
                {historyOrders.map((o) => (
                  <button
                    key={o.clientOrderId}
                    onClick={() => {
                      setActiveOrderId(o.id)
                      setScreen('status')
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-[12px] bg-white p-4 text-left shadow-sm transition-transform active:scale-[0.99]"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-black">#{o.orderNumber}</p>
                      <p className="truncate text-xs text-soil">
                        {o.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-black">{formatRupiah(o.total)}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${o.paymentStatus === 'paid' ? 'text-white' : 'bg-sand text-stone'}`}
                      style={o.paymentStatus === 'paid' ? { background: theme.accent } : undefined}
                    >
                      {o.status} · {o.paymentStatus}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setScreen('menu')}
                  style={{ background: theme.primary }}
                  className="h-12 flex-1 rounded-[8px] text-sm font-semibold text-white"
                >
                  Pesan Lagi
                </button>
                <button
                  onClick={handleEndSession}
                  className="flex h-12 items-center justify-center gap-1.5 rounded-[8px] border border-clay bg-white px-4 text-sm font-semibold text-stone"
                  title="Tutup sesi & hapus riwayat di HP ini"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span>
                  <span>Selesai</span>
                </button>
              </div>
            </div>
          )}
          </div>}
        </main>
        {(screen === 'payment' || screen === 'status') && activeOrder && staleStatusFor === activeOrder.id && (
          <p role="status" className="shrink-0 bg-amber-50 px-4 py-2 text-xs text-amber-950">Koneksi terputus. Menampilkan status terakhir sambil mencoba lagi.</p>
        )}
        <BottomNav
              currentScreen={screen}
              hasActiveOrder={Boolean(activeOrder)}
              onNavigate={(targetScreen) => setScreen(targetScreen)}
              />
        {popup && (
          <ItemSheet item={popup} onClose={() => setPopup(null)} onAdd={addToCart} />
        )}
      </div>
    </div>
  )
}
