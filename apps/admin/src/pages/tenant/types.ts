// Tipe bersama halaman Detail Tenant — cerminan respons GET /api/platform/tenants/:id
// dan GET .../doku-subaccount. Jangan ubah bentuknya tanpa mengikuti backend.

export type TenantDetail = {
  business: {
    id: number
    name: string
    slug: string | null
    email: string | null
    phone: string | null
    address: string | null
    status: string
    isPlatformSuspended: boolean
    onboardedAt: string | null
    createdAt: string
    featureOverrides: Record<string, boolean> | null
    platformFee: {
      enabled: boolean
      mode: string
      percent: string | number
      flat: string | number
      bearer: string
    } | null
  }
  plan: { code: string; name: string } | null
  subscriptions: { id: number; status: string; plan: { code: string; name: string } }[]
  staff: { id: number; name: string; email: string; role: string }[]
  usage: { staffCount: number; tableCount: number; orders30d: number; revenue30d: string | number }
  auditLogs: {
    id: number
    action: string
    before: unknown
    after: unknown
    createdAt: string
    platformAdmin: { name: string; email: string } | null
  }[]
}

export type SubInfo = {
  profileId: string | null
  subAccountStatus: string
  balance: unknown
  settlement: Record<string, string | null>
  subAccounts: unknown
} | null

export type TenantTabKey = 'overview' | 'config' | 'payment' | 'audit'

// Kanon full kill-switch (offlineSync disengaja dikecualikan; taxAndFees lawas hanya alias baca).
export const KNOWN_FLAGS = ['selfOrder', 'tableManagement', 'inventory', 'analyticsFull', 'salesType', 'performanceItem', 'exportCsv', 'themePreset', 'themeCustom', 'serviceCharge', 'taxFees']

export const FLAG_HINTS: Record<string, string> = {
  selfOrder: 'Checkout QR pelanggan (OFF = order publik 403)',
  tableManagement: 'Tulis meja (tambah/edit/QR/hapus)',
  inventory: 'Seluruh modul bahan & stok',
  analyticsFull: 'Analitik lengkap (OFF = dashboard ringkas, /sales 403)',
  salesType: 'Tab & data Self vs Manual',
  performanceItem: 'Halaman Performa Item',
  exportCsv: 'Tombol ekspor CSV owner',
  themePreset: 'Preset tema sekali-klik',
  themeCustom: 'Kustom penuh tema (warna/font/gambar)',
  serviceCharge: 'Service Charge owner (OFF = service NOL di order baru)',
  taxFees: 'Pajak owner (OFF = pajak NOL di order baru)',
  taxAndFees: 'LEGACY — alias lama, menurunkan ke serviceCharge + taxFees bila keduanya belum diatur',
}

export type FeatureGroup = { title: string; desc: string; flags: string[] }

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: 'Akses Modul',
    desc: 'Modul operasional yang boleh dibuka tenant.',
    flags: ['selfOrder', 'tableManagement', 'inventory'],
  },
  {
    title: 'Analitik & Laporan',
    desc: 'Kedalaman dashboard dan laporan owner.',
    flags: ['analyticsFull', 'salesType', 'performanceItem', 'exportCsv'],
  },
  {
    title: 'Tema Self-Order',
    desc: 'Kustomisasi tampilan halaman pelanggan.',
    flags: ['themePreset', 'themeCustom'],
  },
  {
    title: 'Pajak & Biaya',
    desc: 'Komponen yang ikut ke total order baru (OFF = NOL).',
    flags: ['serviceCharge', 'taxFees', 'taxAndFees'],
  },
]

export function rp(n: number): string {
  return `Rp${n.toLocaleString('id-ID')}`
}

export function formatDateId(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('id-ID')
}
