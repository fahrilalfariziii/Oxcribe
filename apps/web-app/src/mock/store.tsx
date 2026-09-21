import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  seedBusiness,
  seedCategories,
  seedIngredients,
  seedMovements,
  seedOrders,
  seedProducts,
  seedStaff,
  seedTables,
} from './data'
import { uid } from '../shared/lib/format'
import { isFeatureOn } from '../shared/lib/features'
import type {
  Business,
  CafeTable,
  CartItem,
  Category,
  ConnectionStatus,
  Ingredient,
  Order,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  StaffUser,
  StockMovement,
} from '../shared/types'
import { normalizeTheme } from '../shared/types'
import type { PaymentSettings } from '../shared/types'
import { api } from '../lib/api'

interface Session {
  user: StaffUser
}

interface CafeStore {
  business: Business
  staff: StaffUser[]
  categories: Category[]
  products: Product[]
  tables: CafeTable[]
  orders: Order[]
  ingredients: Ingredient[]
  movements: StockMovement[]
  session: Session | null
  authMode: 'server' | 'local'
  /** True selama sesi awal dipulihkan (token -> getMe). Guard wajib menunggu ini
   *  sebelum redirect ke login, kalau tidak refresh selalu menendang keluar. */
  isHydrating: boolean
  connection: ConnectionStatus
  pendingSyncCount: number
  login: (email: string, password: string) => StaffUser | null
  logout: () => void
  placeOrder: (payload: {
    items: CartItem[]
    customerName: string
    tableId: string | null
    tableNumber: string | null
    paymentMethod: PaymentMethod
    source: Order['source']
    offline?: boolean
  }) => Order
  updateOrderStatus: (orderId: string, status: OrderStatus) => void
  markPaid: (orderId: string, status?: PaymentStatus) => void
  toggleProductAvailability: (productId: string) => Promise<void>
  upsertProduct: (product: Product, isNew: boolean) => Promise<string>
  removeProduct: (productId: string) => Promise<void>
  saveProductOptions: (productId: string, options: { name: string; type: string; price: number; isRequired: boolean }[]) => Promise<void>
  upsertCategory: (category: Category, isNew: boolean) => Promise<void>
  removeCategory: (categoryId: string) => Promise<void>
  upsertTable: (table: CafeTable, isNew: boolean) => Promise<void>
  removeTable: (tableId: string) => Promise<void>
  regenerateTableQr: (tableId: string) => Promise<string>
  upsertIngredient: (ingredient: Ingredient) => Promise<void>
  removeIngredient: (ingredientId: string) => Promise<void>
  recordStock: (
    ingredientId: string,
    type: StockMovement['type'],
    quantity: number,
    notes: string,
    extras?: {
      supplier?: string; referenceNo?: string; unitCost?: number;
      batchNo?: string; expiryDate?: string; reason?: string
    },
  ) => Promise<void>
  refreshMovementsFromBackend: (ingredientId?: string) => Promise<void>
  updateBusiness: (patch: Partial<Business> & { enabledPaymentMethods?: PaymentMethod[]; paymentSettings?: Record<string, PaymentSettings> }) => void
  refreshBusinessFromBackend: () => Promise<void>
  saveCashSettings: (patch: { openingCash?: number; closingCash?: number | null; soundEnabled?: boolean }) => Promise<void>
  saveBusinessSettings: (patch: Record<string, unknown>) => Promise<void>
  upsertStaff: (user: StaffUser, isNew: boolean) => Promise<void>
  removeStaff: (staffId: string) => Promise<void> 
  setConnection: (status: ConnectionStatus) => void
  syncNow: () => void
  // BE integration (async, with fallback to mock)
  loginAsync: (email: string, password: string) => Promise<StaffUser | null>
  refreshSessionFromBackend: () => Promise<void>
  fetchCatalogFromBackend: (qrToken: string) => Promise<{ tableNumber: string; tableId: number } | null>
  createRealOrder: (payload: { qrToken: string; customerName: string; paymentMethod: PaymentMethod; items: { productId: string; quantity: number; selectedOptionIds?: number[] }[] }) => Promise<Order | null>
  refreshOrderFromBackend: (clientOrderId: string) => Promise<Order | null>
  restoreOrderHistory: (qrToken: string) => Promise<{ orders: Order[]; owner: OrderOwner | null }>
  rechargeOrderFromBackend: (clientOrderId: string, selectedBank?: string) => Promise<Order | null>
  refreshStaffFromBackend: () => Promise<void>
  refreshTablesFromBackend: () => Promise<void>
  refreshIngredientsFromBackend: () => Promise<void>
  refreshProductsFromBackend: () => Promise<void>
  refreshCategoriesFromBackend: () => Promise<void>
  refreshOrdersFromBackend: () => Promise<void>
}

const CafeContext = createContext<CafeStore | null>(null)

// Marker agar caller bisa bedakan "order tidak ada di server" (stop polling +
// buang storage basi) dari error transient (tetap retry diam-diam).
// Dilempar oleh refreshOrderFromBackend saat kedua endpoint publik balas 404.
// Catatan: order mock lokal (id "ord-…", fallback offline) memang tidak ada di BE
// dan tidak boleh dianggap basi — caller harus skip refresh untuknya.
export const ORDER_NOT_FOUND = 'ORDER_NOT_FOUND'

function isNotFoundError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const status = (e as { status?: unknown }).status
  if (status === 404) return true
  const msg = e instanceof Error ? e.message : String(e)
  return /404|tidak ditemukan|not found/i.test(msg)
}

export function isOrderNotFoundError(e: unknown): boolean {
  return e instanceof Error && e.message === ORDER_NOT_FOUND
}

/** Hapus jejak order aktif yang basi (mis. DB habis di-seed ulang). */
export function clearStaleOrderStorage(): void {
  try {
    localStorage.removeItem('servopay:activeOrder')
    localStorage.removeItem('servopay:activeClientOrderId')
    localStorage.removeItem('servopay:activeOrderId')
  } catch {}
}

// ---- Riwayat pesanan milik pelanggan (per perangkat, per sesi nama+meja) ----
const HISTORY_KEY = 'servopay:orderHistory'
const OWNER_KEY = 'servopay:orderOwner'
const MAX_HISTORY = 20

export interface OrderOwner {
  customerName: string
  qrToken: string
}

function normName(s: string): string {
  return s.trim().toLowerCase()
}

export function readOrderOwner(): OrderOwner | null {
  try {
    const raw = localStorage.getItem(OWNER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OrderOwner>
    if (!parsed || typeof parsed.customerName !== 'string' || typeof parsed.qrToken !== 'string') return null
    return { customerName: parsed.customerName, qrToken: parsed.qrToken }
  } catch {
    return null
  }
}

export function readOrderHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeOrderHistory(ids: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(ids.slice(0, MAX_HISTORY)))
  } catch {}
}

/** Sesi pelanggan (nama+meja) untuk riwayat. */
export function readOrderSession(): { owner: OrderOwner | null; clientOrderIds: string[] } {
  return { owner: readOrderOwner(), clientOrderIds: readOrderHistory() }
}

export function removeFromOrderHistory(clientOrderId: string): void {
  writeOrderHistory(readOrderHistory().filter((id) => id !== clientOrderId))
}

/** Tutup sesi pelanggan: bersihkan SEMUA jejak (aktif + riwayat + pemilik). */
export function clearOrderSessionStorage(): void {
  clearStaleOrderStorage()
  try {
    localStorage.removeItem(HISTORY_KEY)
    localStorage.removeItem(OWNER_KEY)
  } catch {}
}

export function CafeProvider({ children }: { children: ReactNode }) {
  const [business, setBusiness] = useState(seedBusiness)
  const [staff, setStaff] = useState(seedStaff)
  const [categories, setCategories] = useState<Category[]>(seedCategories)
  const [products, setProducts] = useState(seedProducts)
  const [tables, setTables] = useState(seedTables)
  const [orders, setOrders] = useState(seedOrders)
  const [ingredients, setIngredients] = useState(seedIngredients)
  const [movements, setMovements] = useState(seedMovements)
  const [session, setSession] = useState<Session | null>(null)
  // 'server' = login via BE (token valid); 'local' = fallback mock saat BE mati.
  // Membedakan keduanya di UI agar user tahu perubahannya hanya lokal.
  const [authMode, setAuthMode] = useState<'server' | 'local'>(() => {
    try {
      return localStorage.getItem('servopay_offline_mode') === '1' ? 'local' : 'server'
    } catch {
      return 'server'
    }
  })
  const [connection, setConnection] = useState<ConnectionStatus>('online')

  // Hydrate session saat mount — hanya jika ada token tersimpan.
  // Halaman publik (self-order/login) tanpa sesi tidak boleh menembak /auth/me
  // (pasti 401 + memicu refresh 401 kedua yang mengotori console).
  const [isHydrating, setIsHydrating] = useState(true)
  useEffect(() => {
    if (!localStorage.getItem('servopay_token')) {
      setIsHydrating(false)
      return
    }
    let cancelled = false
    api.getMe()
      .then((u) => {
        if (cancelled) return
        setSession({
          user: {
            id: api.toFrontendId('u', u.id),
            name: u.name,
            email: u.email,
            role: u.role as StaffUser['role'],
            active: u.active,
            password: '',
          },
        })
        setAuthMode('server')
      })
      .catch(() => {
        if (cancelled) return
        // Token basi — buang agar mount berikutnya tidak mengulang 401
        // dan tidak dipakai sebagai identitas peran yang salah.
        localStorage.removeItem('servopay_token')
      })
      .finally(() => {
        if (!cancelled) setIsHydrating(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Generic BE sync helpers (BE-first with fallback)
  const refreshStaffFromBackend = useCallback(async () => {
    try {
      const list = (await api.getStaff()) as unknown as { id: number; name: string; email: string; role: string; active: boolean }[]
      setStaff(list.map((u) => ({ id: api.toFrontendId('u', u.id), name: u.name, email: u.email, role: u.role as import('../shared/types').UserRole, active: u.active, password: '' })))
    } catch {}
  }, [])
  const refreshTablesFromBackend = useCallback(async () => {
    try {
      const list = (await api.getTables()) as unknown as { id: number; tableNumber: string; qrToken: string; isActive: boolean; area?: string | null; qrConfig?: import('../shared/types').QrConfig }[]
      setTables(list.map((t) => ({ id: api.toFrontendId('t', t.id), tableNumber: t.tableNumber, qrToken: t.qrToken, isActive: t.isActive, area: t.area ?? undefined, qrConfig: t.qrConfig })))
    } catch {}
  }, [])
  const refreshIngredientsFromBackend = useCallback(async () => {
    try {
      const list = (await api.getIngredients()) as unknown as { id: number; name: string; unit: string; currentStock: string | number; minimumStock: string | number; isAvailable: boolean }[]
      setIngredients(list.map((i) => ({ id: api.toFrontendId('i', i.id), name: i.name, unit: i.unit, currentStock: Number(i.currentStock), minimumStock: Number(i.minimumStock), isAvailable: i.isAvailable })))
    } catch {}
  }, [])
  const refreshProductsFromBackend = useCallback(async () => {
    try {
      const list = (await api.getProducts()) as unknown as { id: number; categoryId: number; name: string; description?: string | null; price: string | number; hpp?: string | number | null; imageUrl?: string | null; isAvailable: boolean; badge?: string | null; options: { id: number; name: string; type: string; price: string | number; isRequired: boolean }[] }[]
      // Normalisasi NULL DB -> undefined/'' agar tidak terkirim balik sebagai null (400)
      setProducts(list.map((p) => ({ id: api.toFrontendId('p', p.id), categoryId: api.toFrontendId('c', p.categoryId), name: p.name, description: p.description ?? '', price: Number(p.price), hpp: p.hpp ? Number(p.hpp) : undefined, imageUrl: p.imageUrl ?? '', isAvailable: p.isAvailable, badge: p.badge ?? undefined, options: p.options.map((o) => ({ id: String(o.id), name: o.name, type: o.type, price: Number(o.price), isRequired: o.isRequired })) })))
    } catch {}
  }, [])
  const refreshCategoriesFromBackend = useCallback(async () => {
    try {
      const list = (await api.getCategories()) as unknown as { id: number; name: string; sortOrder: number }[]
      setCategories(list.map((c) => ({ id: api.toFrontendId('c', c.id), name: c.name, sortOrder: c.sortOrder })))
    } catch {}
  }, [])
  const refreshOrdersFromBackend = useCallback(async () => {
    try {
      const list = (await api.getOrders({ limit: 100 })) as unknown as Record<string, unknown>[]
      const mapped = (list as unknown as Parameters<typeof mapBeOrderToFe>[0][]) .map((raw) => mapBeOrderToFe(raw as unknown as Record<string, unknown>))
      setOrders(mapped)
    } catch {}
  }, [])

  const pendingSyncCount = orders.filter((o) => o.syncStatus !== 'synced').length

  const login = useCallback((email: string, password: string): StaffUser | null => {
    const found = staff.find((s) => s.email.toLowerCase() === email.toLowerCase())
    if (!found || !found.active) return null
    if (found.password !== password) return null
    setSession({ user: found })
    return found
  }, [staff])

  const logout = useCallback(() => {
    // Try BE logout (clear httpOnly cookie), ignore error
    api.logout().catch(() => {})
    try {
      localStorage.removeItem('servopay_token')
      localStorage.removeItem('servopay_offline_mode')
    } catch {}
    setAuthMode('server')
    setSession(null)
  }, [])

  const refreshSessionFromBackend = useCallback(async (): Promise<void> => {
    const u = await api.getMe()
    setSession({
      user: {
        id: api.toFrontendId('u', u.id),
        name: u.name,
        email: u.email,
        role: u.role as StaffUser['role'],
        active: u.active,
        password: '',
      },
    })
  }, [])

  const loginAsync = useCallback(async (email: string, password: string): Promise<StaffUser | null> => {
    try {
      const res = await api.login(email, password)
      localStorage.setItem('servopay_token', res.token)
      try {
        localStorage.removeItem('servopay_offline_mode')
      } catch {}
      setAuthMode('server')
      const beUser: StaffUser = {
        id: api.toFrontendId('u', res.user.id),
        name: res.user.name,
        email: res.user.email,
        role: res.user.role as StaffUser['role'],
        active: true,
        password: '',
      }
      setSession({ user: beUser })
      return beUser
    } catch {
      const found = staff.find((s) => s.email.toLowerCase() === email.toLowerCase())
      if (!found || !found.active) return null
      if (found.password !== password) return null
      // Fallback lokal: server tak terjangkau. WAJIB buang token basi — token lama
      // (mis. milik kasir) akan dipakai api.request dan menimbulkan 403 peran yang
      // menyesatkan ("Role 'kasir' tidak diizinkan") padahal user login sebagai owner.
      try {
        localStorage.removeItem('servopay_token')
        localStorage.setItem('servopay_offline_mode', '1')
      } catch {}
      setAuthMode('local')
      setSession({ user: found })
      return found
    }
  }, [staff])

  // BE-first: fetch catalog & business via qrToken. Return info meja bila valid,
  // null bila gagal (fallback mock). Tidak throw — caller yang memutuskan.
  const fetchCatalogFromBackend = useCallback(async (qrToken: string): Promise<{ tableNumber: string; tableId: number } | null> => {
    try {
      const resolve = await api.resolveTable(qrToken)
      const biz = resolve.business as typeof resolve.business & { features?: Record<string, boolean> }
      // Flag granular OFF (default) = paksa komponen NOL di state FE
      // agar cart hitung total murni untuk komponen itu, walau DB lama masih true.
      const taxOn = isFeatureOn({ features: biz.features } as Business, 'taxFees')
      const svcOn = isFeatureOn({ features: biz.features } as Business, 'serviceCharge')
      setBusiness((prev) => ({
        ...prev,
        id: String(biz.id),
        name: biz.name,
        tagline: biz.tagline ?? prev.tagline,
        logoUrl: biz.logoUrl ?? prev.logoUrl,
        taxEnabled: taxOn ? biz.taxEnabled : false,
        taxLabel: biz.taxLabel as Business['taxLabel'],
        taxRate: taxOn ? Number(biz.taxRate) : 0,
        taxBearer: biz.taxBearer as Business['taxBearer'],
        serviceChargeEnabled: svcOn ? biz.serviceChargeEnabled : false,
        serviceChargeRate: svcOn ? Number(biz.serviceChargeRate) : 0,
        serviceChargeMode: (biz.serviceChargeMode as Business['serviceChargeMode']) ?? 'percent',
        serviceChargeFlat: svcOn ? Number(biz.serviceChargeFlat ?? 0) : 0,
        platformFeeEnabled: biz.platformFeeEnabled ?? false,
        platformFeeMode: (biz.platformFeeMode as Business['platformFeeMode']) ?? 'percent',
        platformFeePercent: Number(biz.platformFeePercent ?? 0),
        platformFeeFlat: Number(biz.platformFeeFlat ?? 0),
        platformFeeBearer: (biz.platformFeeBearer as Business['platformFeeBearer']) ?? 'customer',
        features: biz.features ?? { taxAndFees: false, serviceCharge: false, taxFees: false },
        enabledPaymentMethods: (biz.enabledPaymentMethods as PaymentMethod[]) ?? prev.enabledPaymentMethods,
        paymentSettings: (biz.paymentSettings as Record<string, PaymentSettings>) ?? prev.paymentSettings,
        theme: normalizeTheme(biz.theme),
        midtransMode: (biz.midtransMode as Business['midtransMode']) ?? prev.midtransMode,
        hasMidtransCustomKey: biz.hasMidtransCustomKey ?? prev.hasMidtransCustomKey,
      }))
      const catalog = await api.getCatalog(biz.id)
      // Map categories & products
      const newCats: Category[] = catalog.map((c) => ({ id: api.toFrontendId('c', c.id), name: c.name, sortOrder: c.sortOrder }))
      const newProds: Product[] = catalog.flatMap((c) =>
        c.products.map((p) => ({
          id: api.toFrontendId('p', p.id),
          categoryId: api.toFrontendId('c', c.id),
          name: p.name,
          description: p.description ?? '',
          price: Number(p.price),
          imageUrl: p.imageUrl ?? '',
          isAvailable: p.isAvailable,
          badge: p.badge ?? undefined,
          options: p.options.map((o) => ({ id: String(o.id), name: o.name, type: o.type, price: Number(o.price), isRequired: o.isRequired })),
        })),
      )
      setCategories(newCats)
      setProducts(newProds)
      return { tableNumber: resolve.table.tableNumber, tableId: resolve.table.id }
    } catch {
      // fallback to mock data — no throw
      return null
    }
  }, [])

  function mapBeOrderToFe(be: Record<string, unknown>): Order {
    const raw = be as unknown as {
      id: number; orderNumber: string; clientOrderId: string; tableId?: number | null; customerName?: string; source: string; status: string; paymentMethod: string; paymentStatus: string; subtotal: string | number; serviceCharge: string | number; tax: string | number; taxLabel?: string; taxBearer?: string; platformFee?: string | number; platformFeeBearer?: string; mdrFee?: string | number; total: string | number; createdAt: string; items: { id: number; productId: number; productName: string; price: string | number; quantity: number; options?: Record<string, unknown>; optionsLabel?: string; subtotal: string | number }[]; payments?: { gatewayData?: Record<string, unknown> }[]; table?: { tableNumber?: string } | null
    }
    const fe: Order = {
      id: api.toFrontendId('o', raw.id),
      orderNumber: raw.orderNumber,
      clientOrderId: raw.clientOrderId,
      tableId: raw.tableId ? api.toFrontendId('t', raw.tableId) : null,
      tableNumber: raw.table?.tableNumber ?? null,
      customerName: raw.customerName ?? 'Tamu',
      source: raw.source as Order['source'],
      status: raw.status as Order['status'],
      paymentMethod: raw.paymentMethod as PaymentMethod,
      paymentStatus: raw.paymentStatus as PaymentStatus,
      subtotal: Number(raw.subtotal),
      serviceCharge: Number(raw.serviceCharge),
      tax: Number(raw.tax),
      taxLabel: (raw.taxLabel as Business['taxLabel']) ?? 'PB1',
      taxBearer: (raw.taxBearer as Business['taxBearer']) ?? 'customer',
      platformFee: Number(raw.platformFee ?? 0),
      platformFeeBearer: (raw.platformFeeBearer as Business['platformFeeBearer']) ?? 'customer',
      mdrFee: Number(raw.mdrFee ?? 0),
      total: Number(raw.total),
      createdAt: raw.createdAt,
      syncStatus: 'synced',
      items: (raw.items || []).map((it) => ({
        id: api.toFrontendId('oi', it.id),
        productId: api.toFrontendId('p', it.productId),
        productName: it.productName,
        price: Number(it.price),
        quantity: it.quantity,
        options: (it.options as Record<string, string | number | boolean>) ?? {},
        optionsLabel: it.optionsLabel ?? '',
        subtotal: Number(it.subtotal),
      })),
    } as unknown as Order
    // attach payments for PaymentScreen (not in FE type but used as extension)
    ;(fe as unknown as Record<string, unknown>).payments = raw.payments as unknown
    return fe
  }

  const createRealOrder = useCallback(async (payload: { qrToken: string; customerName: string; paymentMethod: PaymentMethod; selectedBank?: string; items: { productId: string; quantity: number; selectedOptionIds?: number[] }[] }): Promise<Order | null> => {
    try {
      const beOrder = (await api.createPublicOrder({
        qrToken: payload.qrToken,
        customerName: payload.customerName,
        paymentMethod: payload.paymentMethod,
        selectedBank: payload.selectedBank,
        items: payload.items.map((i) => ({ productId: api.toBackendId(i.productId), quantity: i.quantity, selectedOptionIds: i.selectedOptionIds })),
        clientOrderId: undefined,
      })) as unknown as Record<string, unknown>
      const fe = mapBeOrderToFe(beOrder as unknown as Record<string, unknown>)
      setOrders((prev) => [fe, ...prev])
      // Sesi pelanggan: nama BERBEDA di meja yang sama = pelanggan baru -> buang riwayat lama.
      // Nama sama (abaikan kapital/spasi) = pelanggan yang sama pesan lagi -> append.
      try {
        const name = payload.customerName.trim()
        const owner = readOrderOwner()
        if (!owner || owner.qrToken !== payload.qrToken || normName(owner.customerName) !== normName(name)) {
          clearStaleOrderStorage()
          writeOrderHistory([])
          localStorage.setItem(OWNER_KEY, JSON.stringify({ customerName: name, qrToken: payload.qrToken }))
        }
        localStorage.setItem('servopay:activeClientOrderId', fe.clientOrderId)
        localStorage.setItem('servopay:activeOrderId', fe.id)
        writeOrderHistory([fe.clientOrderId, ...readOrderHistory().filter((id) => id !== fe.clientOrderId)])
      } catch {}
      return fe
    } catch {
      return null
    }
  }, [])

  const refreshOrderFromBackend = useCallback(async (clientOrderId: string): Promise<Order | null> => {    try {
      const res = (await api.getPublicOrderStatus(clientOrderId)) as unknown as { order: Record<string, unknown> }
      const fe = mapBeOrderToFe(res.order)
      setOrders((prev) => {
        const i = prev.findIndex((o) => o.clientOrderId === clientOrderId)
        if (i === -1) return [fe, ...prev]
        const next = [...prev]
        next[i] = fe
        return next
      })
      return fe
    } catch (first) {
      if (!isNotFoundError(first)) return null
      try {
        const raw = (await api.getPublicOrder(clientOrderId)) as unknown as Record<string, unknown>
        const fe = mapBeOrderToFe(raw)
        setOrders((prev) => {
          const i = prev.findIndex((o) => o.clientOrderId === clientOrderId)
          if (i === -1) return [fe, ...prev]
          const next = [...prev]
          next[i] = fe
          return next
        })
        return fe
      } catch (second) {
        if (isNotFoundError(second)) throw new Error(ORDER_NOT_FOUND)
        return null
      }
    }
  }, [])

  // Pulihkan riwayat milik sesi (nama+meja) ini dari server. Order basi (404)
  // dilewati diam-diam + dibersihkan dari daftar. Meja beda -> kosong.
  const restoreOrderHistory = useCallback(async (qrToken: string): Promise<{ orders: Order[]; owner: OrderOwner | null }> => {
    const owner = readOrderOwner()
    if (!owner || owner.qrToken !== qrToken) return { orders: [], owner: null }
    const ids = readOrderHistory()
    const settled = await Promise.allSettled(ids.map((id) => refreshOrderFromBackend(id)))
    const ok: Order[] = []
    const gone: string[] = []
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) ok.push(r.value)
      else if (r.status === 'rejected' && isOrderNotFoundError(r.reason)) gone.push(ids[i])
    })
    if (gone.length > 0) writeOrderHistory(readOrderHistory().filter((id) => !gone.includes(id)))
    return { orders: ok, owner }
  }, [refreshOrderFromBackend])

  // Terbitkan charge Midtrans baru (ID unik baru) untuk order pending yang
  // QR/VA-nya gagal terbit. Gagal -> throw agar UI jujur.
  const rechargeOrderFromBackend = useCallback(async (clientOrderId: string, selectedBank?: string): Promise<Order | null> => {
    const raw = (await api.rechargePublicOrder(clientOrderId, selectedBank)) as unknown as Record<string, unknown>
    const fe = mapBeOrderToFe(raw)
    setOrders((prev) => {
      const i = prev.findIndex((o) => o.clientOrderId === clientOrderId)
      if (i === -1) return [fe, ...prev]
      const next = [...prev]
      next[i] = fe
      return next
    })
    return fe
  }, [])

  const placeOrder = useCallback<CafeStore['placeOrder']>(({ items, customerName, tableId, tableNumber, paymentMethod, source, offline }) => {
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0)
    // Flag granular OFF = komponen fallback lokal pun NOL (fail-closed bila features hilang).
    const taxOn = isFeatureOn(business, 'taxFees')
    const svcOn = isFeatureOn(business, 'serviceCharge') && business.serviceChargeEnabled
    const tEnabled = taxOn && business.taxEnabled
    const serviceCharge = svcOn
      ? (business.serviceChargeMode === 'flat'
        ? Math.max(0, Math.round(business.serviceChargeFlat))
        : Math.round(subtotal * (Math.min(100, Math.max(0, business.serviceChargeRate)) / 100)))
      : 0
    const taxBase = subtotal + serviceCharge
    const rawTax = tEnabled ? Math.round(taxBase * (business.taxRate / 100)) : 0
    const tax = rawTax
    // Platform fee: khusus self_order non-tunai (cerminan backend lib/platform-fee.ts).
    const feeApplicable = source === 'self_order' && (paymentMethod === 'qris' || paymentMethod === 'bank_transfer')
    const platformFee = feeApplicable && business.platformFeeEnabled
      ? (business.platformFeeMode === 'flat'
        ? Math.max(0, Math.round(business.platformFeeFlat))
        : Math.round(subtotal * (Math.min(100, Math.max(0, business.platformFeePercent)) / 100)))
      : 0
    const total = (tEnabled && business.taxBearer === 'cafe' ? subtotal + serviceCharge : subtotal + serviceCharge + tax)
      + (business.platformFeeBearer === 'cafe' ? 0 : platformFee)
    // Gunakan functional update agar tidak stale terhadap orders.length
    let created: Order | null = null
    setOrders((prev) => {
      const n = 9023 + prev.length
      const order: Order = {
        id: uid('ord'),
        orderNumber: `BB-${n}`,
        clientOrderId: uid('cli'),
        tableId,
        tableNumber,
        customerName: customerName || 'Tamu',
        source,
        status: 'diterima',
        paymentMethod,
        paymentStatus: paymentMethod === 'cash' || offline || ['qris','bank_transfer'].includes(paymentMethod) ? 'pending' : 'paid',
        subtotal,
        serviceCharge,
        tax,
        taxLabel: business.taxLabel,
        taxBearer: business.taxBearer,
        platformFee,
        platformFeeBearer: business.platformFeeBearer,
        mdrFee: 0,
        total,
        createdAt: new Date().toISOString(),
        syncStatus: offline || connection === 'offline' ? 'pending' : 'synced',
        items: items.map((i) => ({
          id: uid('item'),
          productId: i.productId,
          productName: i.name,
          price: i.price,
          quantity: i.quantity,
          options: i.options,
          optionsLabel: i.optionsLabel,
          subtotal: i.price * i.quantity,
        })),
      }
      created = order
      return [order, ...prev]
    })
    return created!
  }, [connection, business.features, business.taxEnabled, business.taxRate, business.taxLabel, business.taxBearer, business.serviceChargeEnabled, business.serviceChargeRate, business.serviceChargeMode, business.serviceChargeFlat, business.platformFeeEnabled, business.platformFeeMode, business.platformFeePercent, business.platformFeeFlat, business.platformFeeBearer])

  const updateOrderStatus = useCallback((orderId: string, status: OrderStatus) => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)))
  }, [])

  const markPaid = useCallback((orderId: string, status: PaymentStatus = 'paid') => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, paymentStatus: status } : o)))
  }, [])

  const toggleProductAvailability = useCallback(async (productId: string): Promise<void> => {
    // BE-first jujur: hitung target dari state saat ini, PATCH ke BE dulu,
    // baru update lokal saat sukses. Gagal -> throw agar caller tampilkan popup error.
    const current = products.find((p) => p.id === productId)
    if (!current) throw new Error('Produk tidak ditemukan di katalog lokal, refresh dulu')
    const nextAvailable = !current.isAvailable
    const beId = api.toBackendId(productId)
    if (!Number.isFinite(beId) || beId <= 0) {
      throw new Error(`ID produk tidak valid (${productId}), refresh katalog dulu`)
    }
    try {
      await api.updateProductAvailability(beId, nextAvailable)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(msg.includes('tidak ditemukan') || msg.includes('404')
        ? 'Produk tidak ditemukan di server (ID basi, katalog akan di-refresh)'
        : msg)
    }
    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, isAvailable: nextAvailable } : p)))
  }, [products])

  // isNew eksplisit dari page (tambah vs edit) — deteksi startsWith menipu karena
  // SEMUA id FE berprefix ("p-1" seed maupun "p-3" dari BE). BE dulu, gagal -> throw.
  const upsertProduct = useCallback(async (product: Product, isNew: boolean): Promise<string> => {
    // Sanitasi null basi (dari DB) -> undefined/'' agar tak terkirim sebagai null (400)
    const payload = {
      name: product.name, description: product.description ?? '', price: product.price,
      hpp: product.hpp, imageUrl: product.imageUrl ?? '', isAvailable: product.isAvailable,
      badge: product.badge ?? undefined, categoryId: api.toBackendId(product.categoryId),
    }
    if (isNew) {
      const created = (await api.createProduct(payload)) as unknown as {
        id: number; categoryId: number; name: string; description?: string; price: string | number;
        hpp?: string | number; imageUrl?: string; isAvailable: boolean; badge?: string;
        options: { id: number; name: string; type: string; price: string | number; isRequired: boolean }[]
      }
      const mapped: Product = {
        id: api.toFrontendId('p', created.id),
        categoryId: api.toFrontendId('c', created.categoryId),
        name: created.name, description: created.description ?? '', price: Number(created.price),
        hpp: created.hpp ? Number(created.hpp) : undefined, imageUrl: created.imageUrl ?? '',
        isAvailable: created.isAvailable, badge: created.badge,
        options: (created.options ?? []).map((o) => ({ id: String(o.id), name: o.name, type: o.type, price: Number(o.price), isRequired: o.isRequired })),
      }
      setProducts((prev) => [...prev, mapped])
      return mapped.id
    }    const beId = api.toBackendId(product.id)
    if (!Number.isFinite(beId) || beId <= 0) throw new Error(`ID produk tidak valid (${product.id}), refresh dulu`)
    const updated = (await api.updateProduct(beId, payload)) as unknown as {
      id: number; categoryId: number; name: string; description?: string; price: string | number;
      hpp?: string | number; imageUrl?: string; isAvailable: boolean; badge?: string;
      options: { id: number; name: string; type: string; price: string | number; isRequired: boolean }[]
    }
    setProducts((prev) =>
      prev.map((p) =>
        p.id === product.id
          ? {
            ...p, name: updated.name, description: updated.description ?? '', price: Number(updated.price),
            hpp: updated.hpp ? Number(updated.hpp) : undefined, imageUrl: updated.imageUrl ?? '',
            isAvailable: updated.isAvailable, badge: updated.badge,
            options: (updated.options ?? p.options).map((o) => ({ id: String(o.id), name: o.name, type: o.type, price: Number(o.price), isRequired: o.isRequired })),
          }
          : p,
      ),
    )
    return product.id
  }, [])

  // Rekonsiliasi varian produk dengan BE (cocok by name+type):
  // hilang -> create, tak dipilih lagi -> delete, berubah harga/required -> update.
  const saveProductOptions = useCallback(async (
    productId: string,
    desired: { name: string; type: string; price: number; isRequired: boolean }[],
  ): Promise<void> => {
    const bePid = api.toBackendId(productId)
    if (!Number.isFinite(bePid) || bePid <= 0) throw new Error(`ID produk tidak valid (${productId}), refresh dulu`)
    const list = (await api.getProducts()) as unknown as {
      id: number; options: { id: number; name: string; type: string; price: string | number; isRequired: boolean; isActive: boolean }[]
    }[]
    const current = list.find((p) => p.id === bePid)?.options ?? []
    const key = (o: { name: string; type: string }) => `${o.type}::${o.name.toLowerCase()}`
    const currentByKey = new Map(current.map((o) => [key(o), o]))
    const desiredKeys = new Set(desired.map(key))

    for (const d of desired) {
      const hit = currentByKey.get(key(d))
      if (!hit) {
        await api.createProductOption(bePid, { name: d.name, type: d.type, price: d.price, isRequired: d.isRequired })
      } else if (Number(hit.price) !== d.price || hit.isRequired !== d.isRequired) {
        await api.updateProductOption(bePid, hit.id, { price: d.price, isRequired: d.isRequired })
      }
    }
    for (const c of current) {
      if (!desiredKeys.has(key(c))) await api.deleteProductOption(bePid, c.id)
    }
    await refreshProductsFromBackend()
  }, [refreshProductsFromBackend])

  const removeProduct = useCallback(async (productId: string): Promise<void> => {
    const beId = api.toBackendId(productId)
    if (!Number.isFinite(beId) || beId <= 0) throw new Error(`ID produk tidak valid (${productId}), refresh dulu`)
    await api.deleteProduct(beId)
    setProducts((prev) => prev.filter((p) => p.id !== productId))
  }, [])

  const upsertCategory = useCallback(async (category: Category, isNew: boolean): Promise<void> => {
    if (isNew) {
      const created = (await api.createCategory({ name: category.name, sortOrder: category.sortOrder })) as unknown as { id: number; name: string; sortOrder: number }
      setCategories((prev) => [...prev, { id: api.toFrontendId('c', created.id), name: created.name, sortOrder: created.sortOrder }])
      return
    }
    const beId = api.toBackendId(category.id)
    if (!Number.isFinite(beId) || beId <= 0) throw new Error(`ID kategori tidak valid (${category.id}), refresh dulu`)
    const updated = (await api.updateCategory(beId, { name: category.name, sortOrder: category.sortOrder })) as unknown as { id: number; name: string; sortOrder: number }
    setCategories((prev) => prev.map((c) => (c.id === category.id ? { ...c, name: updated.name, sortOrder: updated.sortOrder } : c)))
  }, [])

  const removeCategory = useCallback(async (categoryId: string): Promise<void> => {
    const beId = api.toBackendId(categoryId)
    if (!Number.isFinite(beId) || beId <= 0) throw new Error(`ID kategori tidak valid (${categoryId}), refresh dulu`)
    await api.deleteCategory(beId)
    setCategories((prev) => prev.filter((c) => c.id !== categoryId))
    // Produk yang kehilangan kategori ikut disembunyikan dari daftar lokal sampai refresh
    await refreshProductsFromBackend().catch(() => {})
  }, [refreshProductsFromBackend])

  const upsertTable = useCallback(async (table: CafeTable, isNew: boolean): Promise<void> => {
    if (isNew) {
      const created = (await api.createTable({ tableNumber: table.tableNumber, area: table.area })) as unknown as { id: number; tableNumber: string; qrToken: string; isActive: boolean; area?: string }
      setTables((prev) => [...prev, { id: api.toFrontendId('t', created.id), tableNumber: created.tableNumber, qrToken: created.qrToken, isActive: created.isActive, area: created.area }])
      return
    }
    const beId = api.toBackendId(table.id)
    if (!Number.isFinite(beId) || beId <= 0) throw new Error(`ID meja tidak valid (${table.id}), refresh dulu`)
    const updated = (await api.updateTable(beId, { tableNumber: table.tableNumber, area: table.area, isActive: table.isActive, qrConfig: table.qrConfig ?? undefined })) as unknown as { id: number; tableNumber: string; qrToken: string; isActive: boolean; area?: string; qrConfig?: CafeTable['qrConfig'] }
    setTables((prev) => prev.map((t) => (t.id === table.id ? { ...t, tableNumber: updated.tableNumber, area: updated.area, isActive: updated.isActive, qrToken: updated.qrToken, qrConfig: updated.qrConfig ?? t.qrConfig } : t)))
  }, [])

  const removeTable = useCallback(async (tableId: string): Promise<void> => {
    const beId = api.toBackendId(tableId)
    if (!Number.isFinite(beId) || beId <= 0) throw new Error(`ID meja tidak valid (${tableId}), refresh dulu`)
    await api.deleteTable(beId)
    setTables((prev) => prev.filter((t) => t.id !== tableId))
  }, [])

  const regenerateTableQr = useCallback(async (tableId: string): Promise<string> => {
    const beId = api.toBackendId(tableId)
    if (!Number.isFinite(beId) || beId <= 0) throw new Error(`ID meja tidak valid (${tableId}), refresh dulu`)
    const updated = (await api.regenerateTableQr(beId)) as unknown as { qrToken: string }
    setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, qrToken: updated.qrToken } : t)))
    return updated.qrToken
  }, [])

  // Bahan baru -> POST /ingredients, edit -> PUT (tambah/edit boleh kasir/barista;
  // nonaktifkan tetap owner-only). BE dulu, baru update lokal dari response.
  const upsertIngredient = useCallback(async (ingredient: Ingredient): Promise<void> => {
    const isNew = ingredient.id.startsWith('ing-') || ingredient.id.startsWith('i-')
    if (isNew) {
      const created = (await api.createIngredient({
        name: ingredient.name,
        unit: ingredient.unit,
        currentStock: ingredient.currentStock,
        minimumStock: ingredient.minimumStock,
      })) as unknown as { id: number; name: string; unit: string; currentStock: string | number; minimumStock: string | number; isAvailable: boolean }
      const mapped: Ingredient = {
        id: api.toFrontendId('i', created.id),
        name: created.name,
        unit: created.unit,
        currentStock: Number(created.currentStock),
        minimumStock: Number(created.minimumStock),
        isAvailable: created.isAvailable,
      }
      setIngredients((prev) => [...prev, mapped])
      return
    }
    const beId = api.toBackendId(ingredient.id)
    if (!Number.isFinite(beId) || beId <= 0) {
      throw new Error(`ID bahan tidak valid (${ingredient.id}), refresh dulu`)
    }
    const updated = (await api.updateIngredient(beId, {
      name: ingredient.name,
      unit: ingredient.unit,
      minimumStock: ingredient.minimumStock,
      isAvailable: ingredient.isAvailable,
    })) as unknown as { id: number; name: string; unit: string; currentStock: string | number; minimumStock: string | number; isAvailable: boolean }
    setIngredients((prev) =>
      prev.map((x) =>
        x.id === ingredient.id
          ? { ...x, name: updated.name, unit: updated.unit, currentStock: Number(updated.currentStock), minimumStock: Number(updated.minimumStock), isAvailable: updated.isAvailable }
          : x,
      ),
    )
  }, [])

  const removeIngredient = useCallback(async (ingredientId: string): Promise<void> => {
    const beId = api.toBackendId(ingredientId)
    if (!Number.isFinite(beId) || beId <= 0) {
      throw new Error(`ID bahan tidak valid (${ingredientId}), refresh dulu`)
    }
    try {
      await api.deleteIngredient(beId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/404|tidak ditemukan/i.test(msg)) {
        await refreshIngredientsFromBackend().catch(() => {})
        throw new Error('Bahan tidak ditemukan di server (ID basi, daftar sudah di-refresh)')
      }
      throw err instanceof Error ? err : new Error(msg)
    }
    setIngredients((prev) => prev.filter((i) => i.id !== ingredientId))
  }, [refreshIngredientsFromBackend])

  // BE satu-satunya sumber kebenaran stok: POST movement dulu, lalu update lokal
  // dari response server (currentStock/isAvailable apa adanya dari DB).
  const recordStock = useCallback(async (
    ingredientId: string,
    type: StockMovement['type'],
    quantity: number,
    notes: string,
    extras?: {
      supplier?: string; referenceNo?: string; unitCost?: number;
      batchNo?: string; expiryDate?: string; reason?: string
    },
  ): Promise<void> => {
    const beId = api.toBackendId(ingredientId)
    if (!Number.isFinite(beId) || beId <= 0) {
      throw new Error(`ID bahan tidak valid (${ingredientId}), refresh dulu`)
    }
    const res = await api.createMovement(beId, { type, quantity, notes, ...(extras ?? {}) })
    const ing = res.ingredient as unknown as {
      id: number; name: string; unit: string;
      currentStock: string | number; minimumStock: string | number; isAvailable: boolean
    }
    const mv = res.movement as unknown as {
      id: number; ingredientId: number; type: string; quantity: string | number;
      stockBefore: string | number; stockAfter: string | number; notes?: string | null;
      supplier?: string | null; referenceNo?: string | null; unitCost?: string | number | null;
      batchNo?: string | null; expiryDate?: string | null; reason?: string | null; createdAt: string
    }
    setIngredients((prev) =>
      prev.map((i) =>
        i.id === ingredientId
          ? { ...i, currentStock: Number(ing.currentStock), isAvailable: ing.isAvailable }
          : i,
      ),
    )
    setMovements((prev) => [
      {
        id: api.toFrontendId('mv', mv.id),
        ingredientId,
        type: mv.type as StockMovement['type'],
        quantity: Number(mv.quantity),
        stockBefore: Number(mv.stockBefore),
        stockAfter: Number(mv.stockAfter),
        notes: mv.notes ?? '',
        supplier: mv.supplier ?? null,
        referenceNo: mv.referenceNo ?? null,
        unitCost: mv.unitCost !== undefined && mv.unitCost !== null ? Number(mv.unitCost) : null,
        batchNo: mv.batchNo ?? null,
        expiryDate: mv.expiryDate ?? null,
        reason: mv.reason ?? null,
        createdAt: mv.createdAt,
      },
      ...prev,
    ])
  }, [])

  // Muat riwayat movement dari server (untuk 1 bahan atau semua bahan paralel).
  const refreshMovementsFromBackend = useCallback(async (ingredientId?: string): Promise<void> => {
    const targets = ingredientId ? [ingredientId] : ingredients.map((i) => i.id)
    const results = await Promise.all(
      targets.map(async (fid) => {
        const beId = api.toBackendId(fid)
        if (!Number.isFinite(beId) || beId <= 0) return []
        try {
          const list = (await api.getIngredientMovements(beId)) as unknown as {
            id: number; type: string; quantity: string | number;
            stockBefore: string | number; stockAfter: string | number; notes?: string | null;
            supplier?: string | null; referenceNo?: string | null; unitCost?: string | number | null;
            batchNo?: string | null; expiryDate?: string | null; reason?: string | null; createdAt: string
          }[]
          return list.map((m) => ({
            id: api.toFrontendId('mv', m.id),
            ingredientId: fid,
            type: m.type as StockMovement['type'],
            quantity: Number(m.quantity),
            stockBefore: Number(m.stockBefore),
            stockAfter: Number(m.stockAfter),
            notes: m.notes ?? '',
            supplier: m.supplier ?? null,
            referenceNo: m.referenceNo ?? null,
            unitCost: m.unitCost !== undefined && m.unitCost !== null ? Number(m.unitCost) : null,
            batchNo: m.batchNo ?? null,
            expiryDate: m.expiryDate ?? null,
            reason: m.reason ?? null,
            createdAt: m.createdAt,
          }) as StockMovement)
        } catch {
          return []
        }
      }),
    )
    setMovements(results.flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)))
  }, [ingredients])

  const updateBusiness = useCallback((patch: Partial<Business>) => {
    setBusiness((b) => ({ ...b, ...patch }))
    // BE-first: try PUT /api/business (owner only), ignore error
    api.updateBusiness(patch as unknown as Record<string, unknown>).catch(() => {})
  }, [])

  // Muat profil bisnis dari BE (dipakai halaman kasir yang tidak punya qrToken).
  // Decimal dari Prisma datang sebagai string — konversi ke number agar aman.
  // Flag granular OFF (default) = paksa komponen NOL agar total murni untuk komponen itu.
  const refreshBusinessFromBackend = useCallback(async (): Promise<void> => {
    const b = await api.getBusiness()
    const feats = (b.features as Record<string, boolean> | undefined) ?? undefined
    const bizForFlags = { features: feats } as Business
    const taxOn = isFeatureOn(bizForFlags, 'taxFees')
    const svcOn = isFeatureOn(bizForFlags, 'serviceCharge')
    setBusiness((prev) => ({
      ...prev,
      id: String(b.id ?? prev.id),
      name: typeof b.name === 'string' ? b.name : prev.name,
      tagline: typeof b.tagline === 'string' ? b.tagline : prev.tagline,
      address: typeof b.address === 'string' ? b.address : prev.address,
      phone: typeof b.phone === 'string' ? b.phone : prev.phone,
      email: typeof b.email === 'string' ? b.email : prev.email,
      logoUrl: typeof b.logoUrl === 'string' ? b.logoUrl : prev.logoUrl,
      taxEnabled: taxOn ? (typeof b.taxEnabled === 'boolean' ? b.taxEnabled : prev.taxEnabled) : false,
      taxLabel: (b.taxLabel as Business['taxLabel']) ?? prev.taxLabel,
      taxRate: taxOn ? (b.taxRate !== undefined ? Number(b.taxRate) : prev.taxRate) : 0,
      taxBearer: (b.taxBearer as Business['taxBearer']) ?? prev.taxBearer,
      serviceChargeEnabled: svcOn ? (typeof b.serviceChargeEnabled === 'boolean' ? b.serviceChargeEnabled : prev.serviceChargeEnabled) : false,
      serviceChargeRate: svcOn ? (b.serviceChargeRate !== undefined ? Number(b.serviceChargeRate) : prev.serviceChargeRate) : 0,
      serviceChargeMode: (b.serviceChargeMode as Business['serviceChargeMode']) ?? prev.serviceChargeMode,
      serviceChargeFlat: svcOn ? (b.serviceChargeFlat !== undefined ? Number(b.serviceChargeFlat) : prev.serviceChargeFlat) : 0,
      platformFeeEnabled: typeof b.platformFeeEnabled === 'boolean' ? b.platformFeeEnabled : prev.platformFeeEnabled,
      platformFeeMode: (b.platformFeeMode as Business['platformFeeMode']) ?? prev.platformFeeMode,
      platformFeePercent: b.platformFeePercent !== undefined ? Number(b.platformFeePercent) : prev.platformFeePercent,
      platformFeeFlat: b.platformFeeFlat !== undefined ? Number(b.platformFeeFlat) : prev.platformFeeFlat,
      platformFeeBearer: (b.platformFeeBearer as Business['platformFeeBearer']) ?? prev.platformFeeBearer,
      features: feats ?? { taxAndFees: false, serviceCharge: false, taxFees: false },
      soundEnabled: typeof b.soundEnabled === 'boolean' ? b.soundEnabled : prev.soundEnabled,
      openingCash: b.openingCash !== undefined && b.openingCash !== null ? Number(b.openingCash) : prev.openingCash,
      closingCash: b.closingCash !== undefined ? (b.closingCash === null ? null : Number(b.closingCash)) : prev.closingCash,
      cashClosedAt: (b.cashClosedAt as string | null | undefined) ?? prev.cashClosedAt,
      theme: b.theme !== undefined ? normalizeTheme(b.theme) : (prev.theme ? normalizeTheme(prev.theme) : undefined),
      enabledPaymentMethods: (b.enabledPaymentMethods as PaymentMethod[]) ?? prev.enabledPaymentMethods,
      paymentSettings: (b.paymentSettings as Record<string, PaymentSettings>) ?? prev.paymentSettings,
    }))
  }, [])

  // Simpan modal kas & suara via PATCH /cash-settings (boleh kasir/barista/owner).
  // BE dulu, baru update lokal saat sukses; gagal -> throw agar UI jujur.
  const saveCashSettings = useCallback(async (patch: { openingCash?: number; closingCash?: number | null; soundEnabled?: boolean }): Promise<void> => {
    const saved = await api.updateCashSettings(patch)
    setBusiness((prev) => ({
      ...prev,
      ...(saved.openingCash !== undefined && saved.openingCash !== null ? { openingCash: Number(saved.openingCash) } : {}),
      ...(saved.closingCash !== undefined ? { closingCash: saved.closingCash === null ? null : Number(saved.closingCash) } : {}),
      ...('cashClosedAt' in saved ? { cashClosedAt: (saved.cashClosedAt as string | null) ?? null } : {}),
      ...(typeof saved.soundEnabled === 'boolean' ? { soundEnabled: saved.soundEnabled } : {}),
    }))
  }, [])

  // isNew eksplisit (tambah vs edit). Password hanya dikirim bila diisi —
  // BE melewatkan password kosong (tidak diubah). BE dulu, gagal -> throw.
  const upsertStaff = useCallback(async (user: StaffUser, isNew: boolean): Promise<void> => {
    if (isNew) {
      if (!user.password) throw new Error('Password wajib diisi untuk staff baru')
      const created = (await api.createStaff({ name: user.name, email: user.email, role: user.role, password: user.password })) as unknown as { id: number; name: string; email: string; role: string; active: boolean }
      setStaff((prev) => [...prev, { id: api.toFrontendId('u', created.id), name: created.name, email: created.email, role: created.role as StaffUser['role'], active: created.active, password: '' }])
      return
    }
    const beId = api.toBackendId(user.id)
    if (!Number.isFinite(beId) || beId <= 0) throw new Error(`ID staff tidak valid (${user.id}), refresh dulu`)
    const payload: Record<string, unknown> = { name: user.name, email: user.email, role: user.role }
    if (user.active !== undefined) payload.active = user.active
    if (user.password) payload.password = user.password
    const updated = (await api.updateStaff(beId, payload)) as unknown as { id: number; name: string; email: string; role: string; active: boolean }
    setStaff((prev) => prev.map((s) => (s.id === user.id ? { ...s, name: updated.name, role: updated.role as StaffUser['role'], active: updated.active, password: '' } : s)))
  }, [])

  const removeStaff = useCallback(async (staffId: string): Promise<void> => {
    const beId = api.toBackendId(staffId)
    if (!Number.isFinite(beId) || beId <= 0) throw new Error(`ID staff tidak valid (${staffId}), refresh dulu`)
    await api.deleteStaff(beId)
    setStaff((prevStaff) => prevStaff.filter((s) => String(s.id) !== String(staffId)))
  }, [])

  // Simpan pengaturan bisnis (PUT owner-only) — BE dulu, gagal -> throw.
  const saveBusinessSettings = useCallback(async (patch: Record<string, unknown>): Promise<void> => {
    const saved = (await api.updateBusiness(patch)) as unknown as Record<string, unknown>
    setBusiness((prev) => ({
      ...prev,
      ...(typeof saved.name === 'string' ? { name: saved.name } : {}),
      ...(typeof saved.tagline === 'string' ? { tagline: saved.tagline } : {}),
      ...(typeof saved.address === 'string' ? { address: saved.address } : {}),
      ...(typeof saved.phone === 'string' ? { phone: saved.phone } : {}),
      ...(typeof saved.email === 'string' ? { email: saved.email } : {}),
      ...(typeof saved.logoUrl === 'string' ? { logoUrl: saved.logoUrl } : {}),
      ...(typeof saved.taxEnabled === 'boolean' ? { taxEnabled: saved.taxEnabled } : {}),
      ...(typeof saved.taxLabel === 'string' ? { taxLabel: saved.taxLabel as Business['taxLabel'] } : {}),
      ...(saved.taxRate !== undefined ? { taxRate: Number(saved.taxRate) } : {}),
      ...(typeof saved.taxBearer === 'string' ? { taxBearer: saved.taxBearer as Business['taxBearer'] } : {}),
      ...(typeof saved.serviceChargeEnabled === 'boolean' ? { serviceChargeEnabled: saved.serviceChargeEnabled } : {}),
      ...(saved.serviceChargeRate !== undefined ? { serviceChargeRate: Number(saved.serviceChargeRate) } : {}),
      ...(typeof saved.serviceChargeMode === 'string' ? { serviceChargeMode: saved.serviceChargeMode as Business['serviceChargeMode'] } : {}),
      ...(saved.serviceChargeFlat !== undefined ? { serviceChargeFlat: Number(saved.serviceChargeFlat) } : {}),
      ...(typeof saved.platformFeeBearer === 'string' ? { platformFeeBearer: saved.platformFeeBearer as Business['platformFeeBearer'] } : {}),
      ...(Array.isArray(saved.enabledPaymentMethods) ? { enabledPaymentMethods: saved.enabledPaymentMethods as PaymentMethod[] } : {}),
      ...(saved.paymentSettings && typeof saved.paymentSettings === 'object' ? { paymentSettings: saved.paymentSettings as Record<string, PaymentSettings> } : {}),
      ...((saved.theme && typeof saved.theme === 'object') || saved.theme === null ? { theme: normalizeTheme(saved.theme) } : {}),
      ...(saved.features && typeof saved.features === 'object' ? { features: saved.features as Business['features'] } : {}),
    }))
  }, [])

  const syncNow = useCallback(() => {
    setConnection('syncing')
    window.setTimeout(() => {
      setOrders((prev) => prev.map((o) => ({ ...o, syncStatus: 'synced' })))
      setConnection('online')
    }, 800)
  }, [])

  const value = useMemo(
    () => ({
      business,
      staff,
      categories,
      products,
      tables,
      orders,
      ingredients,
      movements,
      session,
      authMode,
      isHydrating,
      connection,
      pendingSyncCount,
      login,
      logout,
      loginAsync,
      refreshSessionFromBackend,
      placeOrder,
      createRealOrder,
      refreshOrderFromBackend,
      restoreOrderHistory,
      rechargeOrderFromBackend,
      fetchCatalogFromBackend,
      refreshStaffFromBackend,
      refreshTablesFromBackend,
      refreshIngredientsFromBackend,
      refreshProductsFromBackend,
      refreshCategoriesFromBackend,
      refreshOrdersFromBackend,
      updateOrderStatus,
      markPaid,
      toggleProductAvailability,
      upsertProduct,
      saveProductOptions,
      removeProduct,
      upsertCategory,
      removeCategory,
      upsertTable,
      removeTable,
      regenerateTableQr,
      upsertIngredient,
      removeIngredient,
      recordStock,
      refreshMovementsFromBackend,
      updateBusiness,
      refreshBusinessFromBackend,
      saveCashSettings,
      saveBusinessSettings,
      upsertStaff,
      removeStaff,
      setConnection,
      syncNow,
    }),
    [
      business,
      staff,
      categories,
      products,
      tables,
      orders,
      ingredients,
      movements,
      session,
      authMode,
      isHydrating,
      connection,
      pendingSyncCount,
      login,
      logout,
      loginAsync,
      refreshSessionFromBackend,
      placeOrder,
      createRealOrder,
      refreshOrderFromBackend,
      restoreOrderHistory,
      rechargeOrderFromBackend,
      fetchCatalogFromBackend,
      refreshStaffFromBackend,
      refreshTablesFromBackend,
      refreshIngredientsFromBackend,
      refreshProductsFromBackend,
      refreshCategoriesFromBackend,
      refreshOrdersFromBackend,
      updateOrderStatus,
      markPaid,
      toggleProductAvailability,
      upsertProduct,
      saveProductOptions,
      removeProduct,
      upsertCategory,
      removeCategory,
      upsertTable,
      removeTable,
      regenerateTableQr,
      upsertIngredient,
      removeIngredient,
      recordStock,
      refreshMovementsFromBackend,
      updateBusiness,
      refreshBusinessFromBackend,
      saveCashSettings,
      saveBusinessSettings,
      upsertStaff,
      removeStaff,
      syncNow,
    ],
  )

  return <CafeContext.Provider value={value}>{children}</CafeContext.Provider>
}

export function useCafe() {
  const ctx = useContext(CafeContext)
  if (!ctx) throw new Error('useCafe must be used inside CafeProvider')
  return ctx
}