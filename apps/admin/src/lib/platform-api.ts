// Klien API Platform Admin: /api/platform/*
// Sesi TERPISAH dari tenant: token di localStorage key servopay_platform_token
// + cookie httpOnly "platform_token" (credentials: include). Token tenant
// (servopay_token) tidak pernah dikirim ke sini, dan sebaliknya.

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:4000'

export const TOKEN_KEY = 'servopay_platform_token'

export type PlatformRole = 'superadmin' | 'support'

export type PlatformAdmin = {
  id: number
  name: string
  email: string
  role: PlatformRole
  active?: boolean
}

export type TenantRow = {
  id: number
  name: string
  slug: string | null
  email: string | null
  phone: string | null
  plan: string | null
  planName: string | null
  subscriptionStatus: string | null
  isPlatformSuspended: boolean
  owner: { id: number; name: string; email: string } | null
  orders30d: number
  totalOrders: number
  onboardedAt: string | null
  createdAt: string
}

export type PlanRow = {
  id: number
  code: string
  name: string
  price: string | number
  billingCycle: string
  featureFlags: Record<string, boolean>
  limits: Record<string, number | null>
  isActive: boolean
  tenantCount?: number
}

export type InvoiceRow = {
  id: number
  invoiceNumber: string
  amount: string | number
  status: string
  periodStart: string | null
  periodEnd: string | null
  dueDate: string | null
  paidAt: string | null
  paidNote: string | null
  createdAt: string
  business: { id: number; name: string; slug: string | null }
}

export type LeadRow = {
  id: number
  businessName: string
  ownerName: string
  email: string
  phone: string | null
  interestedPlanId: number | null
  interestedPlan: PlanRow | null
  jobRole: string | null
  outletCount: string | null
  needCategory: string | null
  message: string | null
  status: string
  createdAt: string
}

export type LandingSectionRow = {
  id: number
  sectionKey: string
  content: Record<string, unknown>
  sortOrder: number
  isPublished: boolean
  updatedAt: string
}

export type AuditRow = {
  id: number
  action: string
  before: unknown
  after: unknown
  createdAt: string
  platformAdmin: { name: string; email: string } | null
  business: { id: number; name: string; slug: string | null } | null
}

function storedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  }
  const token = storedToken()
  if (token && !headers['Authorization']) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' })
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    const error = new Error(err.error || `HTTP ${res.status}`) as Error & { status?: number }
    error.status = res.status
    throw error
  }
  if (res.status === 204) return undefined as unknown as T
  return (await res.json()) as T
}

export const platformApi = {
  login: (email: string, password: string) =>
    request<{ token: string; admin: PlatformAdmin }>('/api/platform/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  getMe: () => request<PlatformAdmin>('/api/platform/auth/me'),
  logout: () => request<{ status: string }>('/api/platform/auth/logout', { method: 'POST' }),

  getTenants: (params?: { plan?: string; status?: string; q?: string }) => {
    const qs = new URLSearchParams()
    if (params?.plan) qs.set('plan', params.plan)
    if (params?.status) qs.set('status', params.status)
    if (params?.q) qs.set('q', params.q)
    const s = qs.toString()
    return request<{ tenants: TenantRow[] }>(`/api/platform/tenants${s ? `?${s}` : ''}`)
  },
  getTenant: (id: number | string) => request<Record<string, unknown>>(`/api/platform/tenants/${id}`),
  createTenant: (payload: Record<string, unknown>) =>
    request<unknown>('/api/platform/tenants', { method: 'POST', body: JSON.stringify(payload) }),
  changePlan: (id: number | string, planCode: string) =>
    request<unknown>(`/api/platform/tenants/${id}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ planCode }),
    }),
  changeStatus: (id: number | string, status: string) =>
    request<unknown>(`/api/platform/tenants/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  resetOwnerPassword: (id: number | string, newPassword: string) =>
    request<unknown>(`/api/platform/tenants/${id}/reset-owner-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  updateOverrides: (id: number | string, overrides: Record<string, boolean | null>) =>
    request<unknown>(`/api/platform/tenants/${id}/feature-overrides`, {
      method: 'PATCH',
      body: JSON.stringify({ overrides }),
    }),
  clearOverrides: (id: number | string) =>
    request<unknown>(`/api/platform/tenants/${id}/feature-overrides`, { method: 'DELETE' }),
  updatePlatformFee: (
    id: number | string,
    payload: {
      platformFeeEnabled?: boolean
      platformFeeMode?: 'percent' | 'flat'
      platformFeePercent?: number
      platformFeeFlat?: number
      platformFeeBearer?: 'customer' | 'cafe'
    },
  ) =>
    request<{ status: string; platformFee: Record<string, unknown> }>(
      `/api/platform/tenants/${id}/platform-fee`,
      { method: 'PATCH', body: JSON.stringify(payload) },
    ),

  getPlans: () => request<{ plans: PlanRow[] }>('/api/platform/plans'),
  updatePlan: (code: string, payload: Record<string, unknown>) =>
    request<PlanRow>(`/api/platform/plans/${code}`, { method: 'PUT', body: JSON.stringify(payload) }),

  getInvoices: (params?: { businessId?: number; status?: string }) => {
    const qs = new URLSearchParams()
    if (params?.businessId) qs.set('businessId', String(params.businessId))
    if (params?.status) qs.set('status', params.status)
    const s = qs.toString()
    return request<{ invoices: InvoiceRow[] }>(`/api/platform/invoices${s ? `?${s}` : ''}`)
  },
  createInvoice: (payload: Record<string, unknown>) =>
    request<InvoiceRow>('/api/platform/invoices', { method: 'POST', body: JSON.stringify(payload) }),
  payInvoice: (id: number, paidNote?: string) =>
    request<InvoiceRow>(`/api/platform/invoices/${id}/pay`, {
      method: 'PATCH',
      body: JSON.stringify(paidNote ? { paidNote } : {}),
    }),
  exportInvoicesUrl: (businessId?: number) =>
    `${API_BASE}/api/platform/invoices/export.csv${businessId ? `?businessId=${businessId}` : ''}`,

  getLeads: (status?: string) =>
    request<{ leads: LeadRow[] }>(`/api/platform/leads${status ? `?status=${status}` : ''}`),
  updateLead: (id: number, status: string) =>
    request<LeadRow>(`/api/platform/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  getContent: () => request<{ sections: LandingSectionRow[] }>('/api/platform/landing-content'),
  saveContent: (sections: { sectionKey: string; content: Record<string, unknown>; isPublished?: boolean }[]) =>
    request<{ sections: LandingSectionRow[] }>('/api/platform/landing-content', {
      method: 'PUT',
      body: JSON.stringify({ sections }),
    }),

  getAnalytics: () => request<Record<string, unknown>>('/api/platform/analytics/overview'),
  getAuditLogs: (params?: { businessId?: number; action?: string }) => {
    const qs = new URLSearchParams()
    if (params?.businessId) qs.set('businessId', String(params.businessId))
    if (params?.action) qs.set('action', params.action)
    const s = qs.toString()
    return request<{ logs: AuditRow[] }>(`/api/platform/audit-logs${s ? `?${s}` : ''}`)
  },
}
