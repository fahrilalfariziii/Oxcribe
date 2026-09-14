const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:4000'

/** True bila error adalah 403 peran (bukan sesi habis) — sarankan logout/login ulang,
 *  karena biasanya token basi milik akun lain yang tertinggal di browser ini. */
export function isRoleMismatchError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const status = (e as { status?: unknown }).status
  if (status !== 403) return false
  const msg = e instanceof Error ? e.message : String(e)
  return /tidak diizinkan|forbidden|role/i.test(msg)
}

export function withReloginHint(e: unknown): string {
  const base = e instanceof Error ? e.message : 'Gagal menyimpan'
  return isRoleMismatchError(e)
    ? `${base} — sesi login mungkin milik akun lain. Logout lalu login ulang.`
    : base
}

async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const isPublic = path.startsWith('/api/public')
  const credentials: RequestCredentials = !isPublic && init.auth !== false ? 'include' : 'omit'
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  // Include Bearer if stored (fallback when cookie not used)
  const stored = localStorage.getItem('servopay_token')
  if (stored && !isPublic && !headers['Authorization']) headers['Authorization'] = `Bearer ${stored}`

  const fetchInit: RequestInit = {
    ...init,
    credentials,
    headers,
    cache: path.startsWith('/api/public') ? 'no-store' as RequestCache : init.cache,
  }
  let res = await fetch(`${API_BASE}${path}`, fetchInit)
  // Silent refresh: hanya jika ada token tersimpan (halaman publik tanpa sesi
  // tidak boleh memicu /auth/refresh yang pasti 401 dan mengotori console).
  const hasSessionHint = typeof window !== 'undefined' && !!localStorage.getItem('servopay_token')
  if (res.status === 401 && hasSessionHint && !path.includes('/auth/refresh') && !path.includes('/auth/login') && !isPublic) {
    try {
      const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' as RequestCredentials })
      if (refreshRes.ok) {
        const refreshData = (await refreshRes.json().catch(() => ({}))) as { token?: string }
        if (refreshData?.token) localStorage.setItem('servopay_token', refreshData.token)
        // retry original request dengan token baru
        const retryHeaders = { ...headers } as Record<string, string>
        if (refreshData?.token) retryHeaders['Authorization'] = `Bearer ${refreshData.token}`
        res = await fetch(`${API_BASE}${path}`, { ...init, credentials, headers: retryHeaders, cache: fetchInit.cache } as RequestInit)
      } else if (refreshRes.status === 401) {
        // Token basi (expired/dihapus server) — buang agar tidak mengulang 401 tiap mount
        localStorage.removeItem('servopay_token')
      }
    } catch {}
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string
      details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] }
    }
    // Rangkum fieldErrors Zod ("Validasi gagal" saja tidak memberi tahu field mana)
    // cth: "Validasi gagal (categoryId: Expected number, received null)"
    const fields = err.details?.fieldErrors
    const fieldBits = fields
      ? Object.entries(fields)
        .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
        .map(([f, msgs]) => `${f}: ${(msgs as string[]).join(', ')}`)
      : []
    const message = fieldBits.length > 0
      ? `${err.error || `Request failed ${res.status}`} (${fieldBits.join('; ')})`
      : (err.error || `Request failed ${res.status}`)
    const error = new Error(message) as Error & { status?: number }
    error.status = res.status
    throw error
  }
  if (res.status === 204) return undefined as unknown as T
  return (await res.json()) as T
}
// Proactive silent refresh tiap 6 jam agar token 7d tidak pernah kadaluarsa saat aktif.
// Hanya jika ada token di localStorage (cookie httpOnly tidak terbaca via document.cookie,
// jadi cek cookie hanya menimbulkan refresh 401 yang sia-sia di halaman publik).
if (typeof window !== 'undefined') {
  setInterval(() => {
    if (!localStorage.getItem('servopay_token')) return
    fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' as RequestCredentials })
      .then(async (r) => {
        if (r.ok) {
          const d = (await r.json().catch(() => ({}))) as { token?: string }
          if (d?.token) localStorage.setItem('servopay_token', d.token)
        }
      })
      .catch(() => {})
  }, 6 * 60 * 60 * 1000)
}

export const api = {
  // Public — no auth, no credentials
  resolveTable: (qrToken: string) =>
    request<{ table: { id: number; tableNumber: string; area?: string; qrConfig?: unknown }; business: { id: number; name: string; tagline?: string; logoUrl?: string; taxEnabled: boolean; taxLabel: string; taxRate: string | number; taxBearer: string; serviceChargeEnabled: boolean; serviceChargeRate: string | number; serviceChargeMode: string; serviceChargeFlat: string | number; platformFeeEnabled: boolean; platformFeeMode: string; platformFeePercent: string | number; platformFeeFlat: string | number; platformFeeBearer: string; enabledPaymentMethods: string[]; paymentSettings: Record<string, unknown>; midtransMode: string; hasMidtransCustomKey: boolean; theme?: unknown; features?: Record<string, boolean> } }>(
      `/api/public/tables/${qrToken}`,
    ),
  getCatalog: (businessId: number) =>
    request<{ id: number; name: string; sortOrder: number; products: { id: number; name: string; description?: string; price: string | number; imageUrl?: string; isAvailable: boolean; badge?: string; options: { id: number; name: string; type: string; price: string | number; isRequired: boolean }[] }[] }[]>(
      `/api/public/businesses/${businessId}/catalog`,
    ),
  createPublicOrder: (payload: { qrToken: string; clientOrderId?: string; customerName: string; paymentMethod: string; selectedBank?: string; items: { productId: number; quantity: number; selectedOptionIds?: number[] }[] }) =>
    request<unknown>(`/api/public/orders`, { method: 'POST', body: JSON.stringify(payload) }),
  getPublicOrder: (clientOrderId: string) => request<unknown>(`/api/public/orders/${clientOrderId}`),
  getPublicOrderStatus: (clientOrderId: string) =>
    request<{ order: unknown; midtrans: unknown | null }>(`/api/public/orders/by-client/${clientOrderId}/status`),
  rechargePublicOrder: (clientOrderId: string, selectedBank?: string) =>
    request<unknown>(`/api/public/orders/by-client/${clientOrderId}/recharge`, { method: 'POST', body: JSON.stringify(selectedBank ? { selectedBank } : {}) }),

  // Auth — with credentials
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: number; name: string; email: string; role: string; businessId: number } }>(`/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  getMe: () => request<{ id: number; name: string; email: string; role: string; active: boolean; businessId: number }>(`/api/auth/me`),
  logout: () => request<{ status: string }>(`/api/auth/logout`, { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string }>(`/api/auth/password`, { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }),

  // Business
  getBusiness: () => request<Record<string, unknown>>(`/api/business`),
  updateBusiness: (patch: Record<string, unknown>) => request<Record<string, unknown>>(`/api/business`, { method: 'PUT', body: JSON.stringify(patch) }),
  updateCashSettings: (patch: { openingCash?: number; closingCash?: number | null; soundEnabled?: boolean }) =>
    request<{ openingCash: string | number; closingCash: string | number | null; cashClosedAt: string | null; soundEnabled: boolean }>(`/api/business/cash-settings`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // Orders (auth)
  getOrders: (params?: Record<string, string | number | undefined>) => {
    const qs = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString()}` : ''
    return request<unknown[]>(`/api/orders${qs}`)
  },
  getOrder: (id: number | string) => request<unknown>(`/api/orders/${id}`),
  createPosOrder: (payload: { clientOrderId?: string; tableId?: number | null; customerName?: string; paymentMethod: string; selectedBank?: string; recordOnly?: boolean; tendered?: number; items: { productId: number; quantity: number; selectedOptionIds?: number[] }[] }) =>
    request<unknown>(`/api/orders`, { method: 'POST', body: JSON.stringify(payload) }),
  updateOrderStatus: (id: number | string, status: string) => request<unknown>(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  markOrderPaid: (id: number | string, data?: { method?: string; reference?: string }) =>
    request<unknown>(`/api/orders/${id}/pay`, { method: 'PATCH', body: JSON.stringify(data ?? {}) }),
  cancelOrder: (id: number | string) => request<unknown>(`/api/orders/${id}/cancel`, { method: 'PATCH' }),
  requestPasswordReset: (email: string) =>
    request<{ status: string; resetUrl?: string }>(`/api/auth/forgot-password`, {
      method: 'POST',
      body: JSON.stringify({ email }),
      auth: false,
    }),
  confirmPasswordReset: (token: string, newPassword: string) =>
    request<{ status: string }>(`/api/auth/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
      auth: false,
    }),

  // Products / Categories / Tables
  getProducts: () => request<unknown[]>(`/api/products`),
  updateProductAvailability: (id: number | string, isAvailable: boolean) =>
    request<unknown>(`/api/products/${id}/availability`, { method: 'PATCH', body: JSON.stringify({ isAvailable }) }),
  createProduct: (payload: Record<string, unknown>) => request<unknown>(`/api/products`, { method: 'POST', body: JSON.stringify(payload) }),
  updateProduct: (id: number | string, payload: Record<string, unknown>) => request<unknown>(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteProduct: (id: number | string) => request<void>(`/api/products/${id}`, { method: 'DELETE' }),
  createProductOption: (productId: number | string, payload: Record<string, unknown>) => request<unknown>(`/api/products/${productId}/options`, { method: 'POST', body: JSON.stringify(payload) }),
  updateProductOption: (productId: number | string, optionId: number | string, payload: Record<string, unknown>) =>
    request<unknown>(`/api/products/${productId}/options/${optionId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteProductOption: (productId: number | string, optionId: number | string) => request<void>(`/api/products/${productId}/options/${optionId}`, { method: 'DELETE' }),

  getCategories: () => request<unknown[]>(`/api/categories`),
  createCategory: (payload: Record<string, unknown>) => request<unknown>(`/api/categories`, { method: 'POST', body: JSON.stringify(payload) }),
  updateCategory: (id: number | string, payload: Record<string, unknown>) => request<unknown>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCategory: (id: number | string) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),

  getTables: () => request<unknown[]>(`/api/tables`),
  createTable: (payload: Record<string, unknown>) => request<unknown>(`/api/tables`, { method: 'POST', body: JSON.stringify(payload) }),
  updateTable: (id: number | string, payload: Record<string, unknown>) => request<unknown>(`/api/tables/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteTable: (id: number | string) => request<void>(`/api/tables/${id}`, { method: 'DELETE' }),
  regenerateTableQr: (id: number | string) => request<unknown>(`/api/tables/${id}/regenerate-qr`, { method: 'POST' }),

  // Staff
  getStaff: () => request<unknown[]>(`/api/staff`),
  createStaff: (payload: Record<string, unknown>) => request<unknown>(`/api/staff`, { method: 'POST', body: JSON.stringify(payload) }),
  updateStaff: (id: number | string, payload: Record<string, unknown>) => request<unknown>(`/api/staff/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteStaff: (id: number | string) => request<void>(`/api/staff/${id}`, { method: 'DELETE' }),

  // Ingredients
  getIngredients: () => request<unknown[]>(`/api/ingredients`),
  createIngredient: (payload: Record<string, unknown>) => request<unknown>(`/api/ingredients`, { method: 'POST', body: JSON.stringify(payload) }),
  updateIngredient: (id: number | string, payload: Record<string, unknown>) => request<unknown>(`/api/ingredients/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteIngredient: (id: number | string) => request<void>(`/api/ingredients/${id}`, { method: 'DELETE' }),
  getIngredientMovements: (id: number | string) => request<unknown[]>(`/api/ingredients/${id}/movements`),
  createMovement: (id: number | string, payload: Record<string, unknown>) => request<{ movement: unknown; ingredient: unknown }>(`/api/ingredients/${id}/movements`, { method: 'POST', body: JSON.stringify(payload) }),

  // Analytics
  getAnalyticsDashboard: (period?: string) => request<Record<string, unknown>>(`/api/analytics/dashboard${period ? `?period=${period}` : ''}`),
  getAnalyticsSales: (period?: string) => request<Record<string, unknown>>(`/api/analytics/sales${period ? `?period=${period}` : ''}`),

  // Helper to map backend numeric IDs to frontend string ids
  toFrontendId: (prefix: string, n: number | string) => `${prefix}-${String(n)}`,
  toBackendId: (id: string) => {
    const parts = String(id).split('-')
    const last = parts[parts.length - 1]
    const num = Number(last)
    return Number.isFinite(num) ? num : Number(id)
  },
}
