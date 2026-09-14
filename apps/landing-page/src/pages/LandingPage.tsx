import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Headbar } from '../components/Headbar'
import { Footer } from '../components/Footer'
import { FALLBACK_PLANS, fetchPlans, formatRupiah, type Plan } from '../lib/api'

const BENTO = [
  {
    icon: 'qr_code_2',
    title: 'Zero App Download',
    desc: 'Pelanggan scan QR di meja dan langsung memesan dari browser HP — tanpa install aplikasi apa pun.',
    tag: 'Fast Checkout',
  },
  {
    icon: 'bolt',
    title: 'Feed Order Real-time',
    desc: 'Pesanan self-order masuk ke layar kasir/barista seketika, lengkap dengan notifikasi suara dan update status live ke pelanggan.',
    tag: 'Auto Sync Data',
  },
  {
    icon: 'inventory_2',
    title: 'Manajemen Bahan & Stok',
    desc: 'Catat penerimaan dan penyesuaian stok dengan alasan wajib — seluruh pergerakan tersimpan sebagai riwayat.',
    tag: 'Stock Opname',
  },
  {
    icon: 'monitoring',
    title: 'Analitik Owner',
    desc: 'Pantau omset, Self Order vs Manual, dan performa item per menu/kategori/varian — bisa diekspor ke CSV.',
    tag: 'Owner Analytics',
  },
]

const STARTER_FEATURES = [
  'POS Kasir & Barista Input Manual',
  'Cetak Struk ESC-POS & Print Preview',
  'Dashboard Owner Sederhana',
  'Dukungan Email & Komunitas',
]
const STARTER_GATED = ['Self-Ordering QR Pelanggan', 'Manajemen Bahan & Stok', 'Offline Mode & Auto Sync']
const PRO_FEATURES = [
  'Self-Ordering QR Meja',
  'Manajemen Bahan & Stok',
  'Offline Mode & Sinkronisasi',
  'Dashboard Analytics Lengkap & Export CSV',
  'Akun Staff Tanpa Batas Wajar',
  'Preset Kustomisasi Tema Self-Order',
  'Dukungan Prioritas WhatsApp/Email',
]
const ENTERPRISE_FEATURES = [
  'Unlimited Meja & Multi-Outlet (implementasi bertahap)',
  'Custom Domain & White-label Penuh',
  'Integrasi API Khusus & Custom Reports',
  'Dedicated Support & SLA',
  'Pelatihan untuk Tim & Barista',
]

const FAQS = [
  {
    q: 'Apakah pelanggan harus download aplikasi untuk Self-Ordering?',
    a: 'Tidak. Pelanggan cukup mengarahkan kamera HP ke QR di meja — halaman menu langsung terbuka di browser (Chrome/Safari) dan bisa memilih varian hingga membayar via QRIS atau tunai di kasir.',
  },
  {
    q: 'Bagaimana jika koneksi internet di kafe tiba-tiba terputus?',
    a: 'Frontoffice tetap bisa mencatat transaksi tunai dan pergerakan stok sebagai data pending, lalu tersinkron otomatis saat koneksi kembali. Pembayaran non-tunai (QRIS/transfer) membutuhkan koneksi untuk verifikasi.',
  },
  {
    q: 'Apa saja yang bisa dikelola owner dari BackOffice?',
    a: 'Katalog menu beserta varian dan add-ons, kategori, meja beserta QR-nya, akun staff, pengaturan pajak & service charge, metode pembayaran, tema self-order, serta laporan omset dan performa item.',
  },
  {
    q: 'Apakah saya bisa upgrade atau downgrade paket sewaktu-waktu?',
    a: 'Bisa. Hubungi tim sales — perubahan paket langsung memengaruhi akses fitur, sedangkan seluruh data historis tetap tersimpan.',
  },
  {
    q: 'Apakah Oxcribe juga membuatkan website untuk bisnis saya?',
    a: 'Ya. Lewat Jasa Website Oxcribe kami mengerjakan company profile, landing page, katalog & e-commerce, hingga web app custom. Tidak ada harga paket — ceritakan kebutuhan Anda lewat halaman konsultasi dan tim kami akan menyusun penawaran.',
  },
  {
    q: 'Bagaimana alur pemesanan jasa website?',
    a: 'Mulai dari konsultasi gratis untuk memetakan kebutuhan, lalu desain, development, dan deploy beserta maintenance. Setiap tahap dikomunikasikan dan disetujui sebelum lanjut ke tahap berikutnya.',
  },
]

function priceOf(plans: Plan[], code: string): Plan {
  return plans.find((p) => p.code === code) ?? FALLBACK_PLANS.find((p) => p.code === code)!
}

export function LandingPage() {
  const [plans, setPlans] = useState<Plan[]>(FALLBACK_PLANS)
  const [livePlans, setLivePlans] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  useEffect(() => {
    let cancelled = false
    fetchPlans().then(({ plans: list, live }) => {
      if (!cancelled) {
        setPlans(list)
        setLivePlans(live)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const starter = priceOf(plans, 'starter')
  const pro = priceOf(plans, 'pro')
  const maxStaff = starter.limits.maxStaff ?? 3

  return (
    <div className="min-h-screen bg-surface">
      <Headbar />
      <main>
        {/* HERO */}
        <section className="mx-auto w-full max-w-[90rem] overflow-hidden px-4 pb-16 pt-8 sm:px-6 lg:px-8 lg:pb-24 lg:pt-14">
          <div className="relative mx-auto flex max-w-6xl flex-col items-center py-6 text-center sm:py-8">
            <div className="pointer-events-none absolute inset-0 -z-10 scale-95 rounded-3xl bg-gradient-to-tr from-secondary-container/20 via-primary-fixed/30 to-transparent blur-3xl" />
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-secondary/20 bg-secondary-fixed px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-on-secondary-fixed shadow-sm">
              <span className="text-xs font-bold text-secondary">⚡</span>
              SaaS POS Kafe &amp; Jasa Pembuatan Website
            </div>
            <h1 className="font-display mb-5 max-w-4xl text-balance text-[clamp(2rem,7.5vw,4.25rem)] font-bold leading-[1.1] tracking-tight text-on-surface">
              Sistem Kasir &amp; Pemesanan Terpadu untuk{' '}
              <span className="font-bold italic text-secondary">Coffee Shop Modern</span>.
            </h1>
            <p className="mb-8 max-w-2xl text-base leading-relaxed text-on-surface-variant sm:text-lg lg:text-xl">
              Self-order QR meja tanpa unduh aplikasi, feed order real-time untuk kasir/barista,
              manajemen stok, dan analitik owner — semua dalam satu aplikasi.
            </p>
            <div className="mb-6 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
              <Link
                to="/hubungi-sales"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-semibold text-on-primary shadow-lg transition-all hover:bg-primary-container active:scale-95 sm:w-auto"
              >
                Hubungi Sales
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </Link>
              <Link
                to="/jasa-website"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-8 py-4 text-base font-semibold text-on-surface shadow-sm transition-all hover:bg-surface-container-low sm:w-auto"
              >
                <span className="material-symbols-outlined text-[18px] text-secondary">language</span>
                Jasa Website Oxcribe
              </Link>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-on-surface-variant">
              <span className="inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-secondary">bolt</span>
                Setup Didampingi
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-secondary">verified</span>
                Onboarding Terpandu
              </span>
            </div>
          </div>
        </section>

        {/* BENTO FITUR */}
        <section id="fitur" className="mx-auto w-full max-w-[90rem] scroll-mt-20 px-4 pb-20 sm:px-6 lg:px-8">
          <p className="mb-8 text-center text-[11px] font-bold uppercase tracking-widest text-secondary">
            Nilai Unggulan Oxcribe untuk Operasional Kafe
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
            {BENTO.map((f) => (
              <div
                key={f.title}
                className="flex flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary-fixed/60">
                  <span className="material-symbols-outlined text-[22px] text-on-secondary-fixed">{f.icon}</span>
                </div>
                <h3 className="font-display text-lg font-semibold text-on-surface">{f.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-on-surface-variant">{f.desc}</p>
                <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
                  <span className="material-symbols-outlined text-[15px] text-secondary">check</span>
                  {f.tag}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="w-full scroll-mt-16 bg-surface-container-low py-16 sm:py-20 lg:py-28">
          <div className="mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <span className="mb-2 block text-[13px] font-bold uppercase tracking-widest text-secondary">
                Transparan &amp; Terjangkau
              </span>
              <h2 className="font-display mb-4 text-balance text-[clamp(1.75rem,5vw,3rem)] font-bold leading-tight tracking-tight text-on-surface">
                Pilih Paket yang Pas untuk Skala Bisnis Kafe Anda
              </h2>
              <p className="text-[15px] text-on-surface-variant">
                Transparan, fleksibel, tanpa biaya tersembunyi. Upgrade atau downgrade kapan saja
                sesuai ritme perkembangan outlet Anda.
              </p>
              {!livePlans && (
                <p className="mt-3 text-xs text-on-surface-variant/70">
                  Menampilkan harga standar (backend tidak terjangkau).
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 items-stretch gap-6 sm:gap-8 lg:grid-cols-3">
              {/* Starter */}
              <div className="flex flex-col justify-between rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-sm sm:p-8">
                <div>
                  <div className="mb-6">
                    <h3 className="font-display mb-1 text-xl font-semibold text-on-surface">Starter</h3>
                    <p className="text-sm text-on-surface-variant">
                      Cocok untuk kafe kecil &amp; booth kopi dengan transaksi kasir manual.
                    </p>
                  </div>
                  <div className="mb-8">
                    <div className="flex items-baseline gap-1">
                      <span className="font-display tabular text-4xl font-bold text-on-surface">
                        {formatRupiah(starter.price)}
                      </span>
                      <span className="text-sm text-on-surface-variant">/bulan</span>
                    </div>
                  </div>
                  <div className="space-y-3 border-t border-surface-container pt-6">
                    <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                      Fitur Termasuk:
                    </span>
                    {STARTER_FEATURES.slice(0, 3).map((f) => (
                      <FeatureRow key={f} text={f} />
                    ))}
                    <FeatureRow text={`Manajemen Staff (Maks. ${maxStaff} akun)`} />
                    <FeatureRow text="Dukungan Email & Komunitas" />
                    {STARTER_GATED.map((f) => (
                      <div key={f} className="flex items-start gap-2.5 text-sm text-on-surface-variant/60 line-through">
                        <span className="material-symbols-outlined shrink-0 text-[18px] text-outline">cancel</span>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-8 pt-6">
                  <Link
                    to="/hubungi-sales"
                    className="inline-flex w-full items-center justify-center rounded-xl bg-surface-container-high py-3 text-[13px] font-semibold text-on-surface transition-all hover:bg-surface-container-highest"
                  >
                    Hubungi Tim Sales
                  </Link>
                </div>
              </div>

              {/* Pro */}
              <div className="relative order-first flex flex-col justify-between rounded-2xl border-2 border-secondary bg-surface-container-lowest p-6 shadow-xl sm:p-8 lg:order-none lg:-translate-y-2">
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-secondary px-4 py-1 text-[11px] font-extrabold uppercase tracking-wider text-on-secondary shadow-sm">
                  Paling Populer untuk Coffee Shop
                </div>
                <div>
                  <div className="mb-6">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display mb-1 text-xl font-semibold text-on-surface">Pro</h3>
                      <span className="rounded bg-secondary-fixed px-2 py-0.5 text-[11px] font-bold text-on-secondary-fixed">
                        Rekomendasi
                      </span>
                    </div>
                    <p className="text-sm text-on-surface-variant">
                      Solusi terlengkap: self-order QR meja, manajemen bahan, dan analisa mendalam.
                    </p>
                  </div>
                  <div className="mb-8">
                    <div className="flex items-baseline gap-1">
                      <span className="font-display tabular text-4xl font-bold text-on-surface">
                        {formatRupiah(pro.price)}
                      </span>
                      <span className="text-sm text-on-surface-variant">/bulan</span>
                    </div>
                  </div>
                  <div className="space-y-3 border-t border-surface-container pt-6">
                    <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-secondary">
                      Semua di Starter, Plus:
                    </span>
                    {PRO_FEATURES.map((f) => (
                      <FeatureRow key={f} text={f} strong={f.startsWith('Self-Ordering') || f.startsWith('Manajemen Bahan')} />
                    ))}
                  </div>
                </div>
                <div className="mt-8 pt-6">
                  <Link
                    to="/hubungi-sales"
                    className="inline-flex w-full items-center justify-center rounded-xl bg-primary-container py-3.5 text-[15px] font-semibold text-on-primary shadow-md transition-all hover:bg-primary"
                  >
                    Hubungi Tim Sales
                  </Link>
                </div>
              </div>

              {/* Enterprise */}
              <div className="flex flex-col justify-between rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-sm sm:p-8">
                <div>
                  <div className="mb-6">
                    <h3 className="font-display mb-1 text-xl font-semibold text-on-surface">Enterprise</h3>
                    <p className="text-sm text-on-surface-variant">
                      Untuk multi-outlet, roastery chain, dan grup kafe berskala besar.
                    </p>
                  </div>
                  <div className="mb-8">
                    <span className="font-display text-4xl font-bold text-on-surface">Custom</span>
                    <p className="mt-1 text-xs text-on-surface-variant">Sesuai kebutuhan cabang &amp; integrasi</p>
                  </div>
                  <div className="space-y-3 border-t border-surface-container pt-6">
                    <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                      Semua Fitur Pro, Ditambah:
                    </span>
                    {ENTERPRISE_FEATURES.map((f) => (
                      <FeatureRow key={f} text={f} />
                    ))}
                  </div>
                </div>
                <div className="mt-8 pt-6">
                  <Link
                    to="/hubungi-sales"
                    className="inline-flex w-full items-center justify-center rounded-xl bg-surface-container-high py-3 text-[13px] font-semibold text-on-surface transition-all hover:bg-surface-container-highest"
                  >
                    Hubungi Tim Sales
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA CARD */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-primary-container p-6 text-on-primary shadow-2xl sm:p-14">
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-secondary-container/20 blur-3xl" />
            <div className="relative z-10 max-w-3xl">
              <span className="mb-4 inline-block rounded-full bg-surface-container-high/20 px-3 py-1 text-[13px] font-semibold uppercase tracking-wider text-on-primary">
                Onboarding Terpandu
              </span>
              <h2 className="font-display mb-4 text-[clamp(1.6rem,5vw,2.5rem)] font-bold leading-tight tracking-tight text-on-primary">
                Siap Tingkatkan Efisiensi &amp; Omset Kafe Anda Hari Ini?
              </h2>
              <p className="mb-8 max-w-xl text-lg text-surface-container-highest/90">
                Diskusikan kebutuhan kafe Anda bersama tim sales Oxcribe — dari pilihan paket,
                jadwal live demo, hingga rencana implementasi di outlet Anda.
              </p>
              <div className="flex max-w-2xl flex-col gap-3 sm:flex-row">
                <Link
                  to="/hubungi-sales"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-secondary-container px-8 py-4 text-base font-semibold text-on-secondary-fixed shadow-md transition-all hover:brightness-95 sm:w-auto"
                >
                  Hubungi Tim Sales
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </Link>
                <a
                  href="#pricing"
                  className="inline-flex w-full items-center justify-center rounded-xl px-8 py-4 text-base font-semibold text-on-primary ring-1 ring-on-primary/30 transition-all hover:bg-white/10 sm:w-auto"
                >
                  Lihat Paket
                </a>
              </div>
              <p className="mt-4 text-sm text-surface-container-highest/70">
                ✓ Setup dibantu tim spesialis • Data isolasi aman tingkat multi-tenant • Support responsif
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto w-full max-w-4xl scroll-mt-20 px-4 py-20 sm:px-6">
          <div className="mb-12 text-center">
            <span className="mb-2 block text-[13px] font-bold uppercase tracking-widest text-secondary">
              Tanya Jawab
            </span>
            <h2 className="font-display text-[clamp(1.75rem,5vw,3rem)] font-bold leading-tight tracking-tight text-on-surface">
              Pertanyaan yang Sering Diajukan
            </h2>
            <p className="mt-2 text-[15px] text-on-surface-variant">
              Semua yang perlu Anda ketahui mengenai implementasi Ordria di kafe Anda.
            </p>
          </div>
          <div className="space-y-4">
            {FAQS.map((f, i) => {
              const open = openFaq === i
              return (
                <div
                  key={f.q}
                  className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest transition-all"
                >
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="flex w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-surface-container-low"
                  >
                    <span className="text-base font-semibold text-on-surface">{f.q}</span>
                    <span
                      className="material-symbols-outlined text-secondary transition-transform duration-300"
                      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    >
                      expand_more
                    </span>
                  </button>
                  {open && (
                    <div className="border-t border-surface-container-low px-5 pb-5 pt-1 text-[15px] leading-relaxed text-on-surface-variant">
                      {f.a}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </main>

      <Footer pos="" />
    </div>
  )
}

function FeatureRow({ text, strong }: { text: string; strong?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-on-surface">
      <span className="material-symbols-outlined shrink-0 text-[18px] text-secondary">check_circle</span>
      <span className={strong ? 'font-semibold' : ''}>{text}</span>
    </div>
  )
}
