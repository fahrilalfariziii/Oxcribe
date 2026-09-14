// Klien API publik landing page: GET /api/public/plans + landing-content + POST /api/public/leads.
// Tanpa kredensial & tanpa token — halaman marketing tidak menyentuh sesi tenant.

export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:4000'

export const WEB_APP_URL =
  (import.meta.env.VITE_WEB_APP_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:5173'

// TODO: ganti dengan nomor WhatsApp sales aktif via VITE_SALES_WHATSAPP.
export const SALES_WHATSAPP =
  (import.meta.env.VITE_SALES_WHATSAPP as string | undefined)?.trim() || '6281234567890'

export function salesWaLink(text: string): string {
  return `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(text)}`
}

export type Plan = {
  code: string
  name: string
  price: number
  billingCycle: string
  limits: { maxTables: number | null; maxStaff: number | null }
}

// Nilai sama persis dengan backend/src/lib/plans.ts — dipakai saat backend tak terjangkau.
export const FALLBACK_PLANS: Plan[] = [
  { code: 'starter', name: 'Starter', price: 149000, billingCycle: 'monthly', limits: { maxTables: 0, maxStaff: 3 } },
  { code: 'pro', name: 'Pro', price: 349000, billingCycle: 'monthly', limits: { maxTables: 30, maxStaff: null } },
  { code: 'enterprise', name: 'Enterprise', price: 0, billingCycle: 'custom', limits: { maxTables: null, maxStaff: null } },
]

export async function fetchPlans(): Promise<{ plans: Plan[]; live: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/api/public/plans`, { cache: 'no-store' })
    if (!res.ok) return { plans: FALLBACK_PLANS, live: false }
    const data = (await res.json()) as { plans?: Plan[] } | Plan[]
    const list = Array.isArray(data) ? data : data.plans
    if (!Array.isArray(list) || list.length === 0) return { plans: FALLBACK_PLANS, live: false }
    return { plans: list, live: true }
  } catch {
    return { plans: FALLBACK_PLANS, live: false }
  }
}

export type SalesInquiry = {
  fullName: string
  jobRole: string
  email: string
  phone: string
  brandName: string
  outletCount: string
  needCategory: string
  message: string
}

export async function submitSalesInquiry(inq: SalesInquiry): Promise<void> {
  const res = await fetch(`${API_BASE}/api/public/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessName: inq.brandName,
      ownerName: inq.fullName,
      email: inq.email,
      phone: inq.phone,
      interestedPlan: planFromCategory(inq.needCategory),
      jobRole: inq.jobRole,
      outletCount: inq.outletCount,
      needCategory: inq.needCategory,
      message: inq.message,
    }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error || `HTTP ${res.status}`)
  }
}

function planFromCategory(category: string): string | null {
  if (category === 'Jasa Website') return null
  if (category === 'Paket Basic') return 'starter'
  if (category === 'Paket Enterprise') return 'enterprise'
  return 'pro'
}

export function formatRupiah(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}

export type HomeProduct = {
  icon: string
  title: string
  desc: string
  ctaLabel: string
  href: string
}

export type HomeFaq = {
  q: string
  a: string
}

export type HomeContent = {
  badge: string
  title: string
  subtitle: string
  products: HomeProduct[]
  cta: { title: string; subtitle: string }
  faqs: HomeFaq[]
}

// Sama persis dengan seed backend (sectionKey "home") — dipakai saat backend tak terjangkau.
export const FALLBACK_HOME: HomeContent = {
  badge: 'SaaS POS Kafe & Jasa Pembuatan Website',
  title: 'Dua Solusi Digital untuk Bisnis Anda.',
  subtitle:
    'Ordria menghadirkan sistem kasir self-order untuk coffee shop modern dan jasa pembuatan website profesional — pilih yang sesuai kebutuhan Anda.',
  products: [
    {
      icon: 'point_of_sale',
      title: 'Oxcribe POS — SaaS Kafe',
      desc: 'Kasir, self-order QR meja, manajemen stok, dan analitik owner dalam satu aplikasi berlangganan.',
      ctaLabel: 'Lihat Paket POS',
      href: '/pos-kafe',
    },
    {
      icon: 'language',
      title: 'Jasa Website Oxcribe',
      desc: 'Company profile, landing page, e-commerce, hingga web app custom — via konsultasi gratis.',
      ctaLabel: 'Jelajahi Jasa Website',
      href: '/jasa-website',
    },
  ],
  cta: {
    title: 'Belum yakin pilih yang mana?',
    subtitle: 'Ceritakan kebutuhan Anda — tim kami akan mengarahkan ke solusi yang paling pas.',
  },
  faqs: [
    {
      q: 'Apa itu Oxcribe?',
      a: 'Oxcribe menghadirkan dua solusi digital: Oxcribe POS, aplikasi kasir & self-order berlangganan untuk coffee shop, dan Jasa Website Oxcribe, layanan pembuatan website profesional untuk berbagai bisnis.',
    },
    {
      q: 'Apa bedanya Oxcribe POS dan Jasa Website?',
      a: 'Oxcribe POS adalah produk SaaS siap pakai dengan paket bulanan — daftar, aktivasi, langsung jalan. Jasa Website adalah layanan custom: setiap website dirancang dan dibangun sesuai kebutuhan spesifik bisnis Anda lewat konsultasi gratis.',
    },
    {
      q: 'Bagaimana cara memulai?',
      a: 'Untuk Oxcribe POS, lihat halaman paket lalu hubungi sales untuk aktivasi. Untuk jasa website, buka halaman Jasa Website Oxcribe lalu kirim kebutuhan Anda lewat formulir konsultasi — gratis tanpa komitmen.',
    },
    {
      q: 'Bagaimana pembayaran dan dukungannya?',
      a: 'Langganan POS mendukung QRIS, transfer bank, dan tunai dengan invoice bulanan. Jasa website memakai penawaran per proyek. Keduanya didukung tim support yang bisa dihubungi via WhatsApp dan email.',
    },
  ],
}

function normalizeHome(raw: unknown): HomeContent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.title !== 'string' || !Array.isArray(r.products)) return null
  const products = (r.products as unknown[]).filter(
    (p): p is HomeProduct =>
      typeof p === 'object' && p !== null &&
      typeof (p as Record<string, unknown>).title === 'string' &&
      typeof (p as Record<string, unknown>).href === 'string',
  ).map((p) => {
    const q = p as Record<string, unknown>
    return {
      icon: typeof q.icon === 'string' && q.icon ? q.icon : 'grid_view',
      title: q.title as string,
      desc: typeof q.desc === 'string' ? q.desc : '',
      ctaLabel: typeof q.ctaLabel === 'string' && q.ctaLabel ? q.ctaLabel : 'Selengkapnya',
      href: q.href as string,
    }
  })
  if (products.length === 0) return null
  const cta = (r.cta ?? {}) as Record<string, unknown>
  const faqs = Array.isArray(r.faqs)
    ? (r.faqs as unknown[])
        .filter(
          (f): f is HomeFaq =>
            typeof f === 'object' && f !== null && typeof (f as Record<string, unknown>).q === 'string',
        )
        .map((f) => {
          const q = f as Record<string, unknown>
          return { q: q.q as string, a: typeof q.a === 'string' ? q.a : '' }
        })
        .filter((f) => f.q.trim() !== '')
    : []
  return {
    badge: typeof r.badge === 'string' ? r.badge : '',
    title: r.title as string,
    subtitle: typeof r.subtitle === 'string' ? r.subtitle : '',
    products,
    cta: {
      title: typeof cta.title === 'string' ? cta.title : '',
      subtitle: typeof cta.subtitle === 'string' ? cta.subtitle : '',
    },
    faqs: faqs.length > 0 ? faqs : FALLBACK_HOME.faqs,
  }
}

export async function fetchHomeContent(): Promise<{ home: HomeContent; live: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/api/public/landing-content`, { cache: 'no-store' })
    if (!res.ok) return { home: FALLBACK_HOME, live: false }
    const data = (await res.json()) as { byKey?: Record<string, unknown> }
    const home = normalizeHome(data.byKey?.home)
    if (!home) return { home: FALLBACK_HOME, live: false }
    return { home, live: true }
  } catch {
    return { home: FALLBACK_HOME, live: false }
  }
}
