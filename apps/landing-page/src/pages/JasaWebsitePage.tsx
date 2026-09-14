import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Headbar } from '../components/Headbar'
import { Footer } from '../components/Footer'

const LAYANAN = [
  {
    icon: 'business',
    title: 'Company Profile',
    desc: 'Website profil perusahaan yang rapi dan meyakinkan — struktur halaman jelas, copywriting terarah, dan tampil profesional di semua perangkat.',
  },
  {
    icon: 'ads_click',
    title: 'Landing Page',
    desc: 'Halaman fokus konversi untuk kampanye, promosi, atau peluncuran produk — cepat dimuat dan dirancang mengantar pengunjung ke aksi.',
  },
  {
    icon: 'shopping_bag',
    title: 'Katalog & E-Commerce',
    desc: 'Tampilkan dan jual produk secara online — katalog mudah dikelola, alur checkout jelas, dan terhubung ke pembayaran digital.',
  },
  {
    icon: 'code',
    title: 'Custom Web App',
    desc: 'Aplikasi web sesuai kebutuhan spesifik bisnis Anda — dashboard, sistem internal, integrasi API, dan fitur yang tidak ada di paket jadi.',
  },
]

const ALUR = [
  {
    no: '1',
    title: 'Konsultasi Gratis',
    desc: 'Ceritakan kebutuhan dan target bisnis Anda. Kami petakan scope, timeline, dan estimasi biaya secara transparan.',
  },
  {
    no: '2',
    title: 'Desain',
    desc: 'Rancangan tampilan dibuat dan direview bersama — revisi hingga Anda setuju sebelum masuk development.',
  },
  {
    no: '3',
    title: 'Development',
    desc: 'Website dibangun responsif, cepat, dan SEO-ready. Progress dikomunikasikan berkala.',
  },
  {
    no: '4',
    title: 'Deploy & Maintenance',
    desc: 'Website diluncurkan ke domain Anda, disertai serah terima dan opsi maintenance lanjutan.',
  },
]

const KEUNGGULAN = [
  { icon: 'smartphone', text: 'Responsif penuh — rapi di HP, tablet, dan desktop' },
  { icon: 'bolt', text: 'Cepat dimuat dan SEO-ready sejak hari pertama' },
  { icon: 'forum', text: 'Komunikasi transparan di setiap tahap pengerjaan' },
  { icon: 'build', text: 'Opsi maintenance dan pengembangan lanjutan' },
]

const FAQ_JASA = [
  {
    q: 'Berapa biaya pembuatan website?',
    a: 'Tidak ada harga paket tetap — biaya disusun berdasarkan scope kebutuhan Anda setelah konsultasi gratis. Sampaikan kebutuhan lewat halaman konsultasi dan tim kami akan menyusun penawaran transparan.',
  },
  {
    q: 'Berapa lama pengerjaannya?',
    a: 'Tergantung kompleksitas: landing page umumnya hitungan minggu, company profile dan e-commerce menyesuaikan jumlah halaman dan fitur. Estimasi timeline diberikan tertulis setelah konsultasi.',
  },
  {
    q: 'Apakah saya bisa request revisi desain?',
    a: 'Bisa. Tahap desain memang dirancang untuk direview dan direvisi bersama hingga Anda setuju, baru dilanjutkan ke development.',
  },
  {
    q: 'Apakah ada maintenance setelah website jadi?',
    a: 'Ada opsi maintenance lanjutan — update konten, pemantauan, dan pengembangan fitur baru sesuai kebutuhan bisnis Anda.',
  },
]

export function JasaWebsitePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <div className="min-h-screen bg-surface">
      <Headbar />
      <main>
        {/* HERO */}
        <section className="mx-auto w-full max-w-[90rem] overflow-hidden px-4 pb-14 pt-8 sm:px-6 lg:px-8 lg:pb-20 lg:pt-14">
          <div className="relative mx-auto flex max-w-6xl flex-col items-center py-6 text-center sm:py-8">
            <div className="pointer-events-none absolute inset-0 -z-10 scale-95 rounded-3xl bg-gradient-to-tr from-secondary-container/20 via-primary-fixed/30 to-transparent blur-3xl" />
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-secondary/20 bg-secondary-fixed px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-on-secondary-fixed shadow-sm">
              <span className="material-symbols-outlined text-[14px]">language</span>
              Jasa Website Oxcribe
            </div>
            <h1 className="font-display mb-5 max-w-4xl text-balance text-[clamp(2rem,7.5vw,4.25rem)] font-bold leading-[1.1] tracking-tight text-on-surface">
              Website Profesional untuk <span className="font-bold italic text-secondary">Bisnis Anda</span>.
            </h1>
            <p className="mb-8 max-w-2xl text-base leading-relaxed text-on-surface-variant sm:text-lg lg:text-xl">
              Dari company profile hingga web app custom — dirancang rapi, cepat, dan siap
              mengembangkan bisnis. Tanpa harga paket: ceritakan kebutuhan Anda, kami susun
              penawarannya.
            </p>
            <div className="mb-6 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
              <Link
                to="/hubungi-sales?layanan=jasa-website"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-semibold text-on-primary shadow-lg transition-all hover:bg-primary-container active:scale-95 sm:w-auto"
              >
                Konsultasi Gratis
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </Link>
              <a
                href="#layanan"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-8 py-4 text-base font-semibold text-on-surface shadow-sm transition-all hover:bg-surface-container-low sm:w-auto"
              >
                Lihat Layanan
              </a>
            </div>
          </div>
        </section>

        {/* LAYANAN */}
        <section id="layanan" className="mx-auto w-full max-w-[90rem] scroll-mt-20 px-4 pb-20 sm:px-6 lg:px-8">
          <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-widest text-secondary">
            Yang Kami Kerjakan
          </p>
          <h2 className="font-display mx-auto mb-10 max-w-2xl text-balance text-center text-[clamp(1.75rem,5vw,3rem)] font-bold leading-tight tracking-tight text-on-surface">
            Layanan Pembuatan Website
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LAYANAN.map((l) => (
              <div
                key={l.title}
                className="flex flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary-fixed/60">
                  <span className="material-symbols-outlined text-[22px] text-on-secondary-fixed">{l.icon}</span>
                </div>
                <h3 className="font-display text-lg font-semibold text-on-surface">{l.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-on-surface-variant">{l.desc}</p>
                <Link
                  to="/hubungi-sales?layanan=jasa-website"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-secondary hover:underline"
                >
                  Konsultasi
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* ALUR KERJA */}
        <section className="w-full bg-surface-container-low py-16 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-8">
            <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-widest text-secondary">
              Cara Kerja Sama
            </p>
            <h2 className="font-display mx-auto mb-10 max-w-2xl text-balance text-center text-[clamp(1.75rem,5vw,3rem)] font-bold leading-tight tracking-tight text-on-surface">
              Alur Pengerjaan yang Transparan
            </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
              {ALUR.map((s) => (
                <div key={s.no} className="rounded-2xl bg-surface-container-lowest p-6 shadow-sm ring-1 ring-outline-variant/40">
                  <span className="font-display text-4xl font-bold text-secondary/40">{s.no}</span>
                  <h3 className="font-display mt-2 text-lg font-semibold text-on-surface">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{s.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {KEUNGGULAN.map((k) => (
                <p key={k.text} className="flex items-center gap-2 text-sm text-on-surface-variant">
                  <span className="material-symbols-outlined text-[18px] text-secondary">{k.icon}</span>
                  {k.text}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-primary-container p-6 text-on-primary shadow-2xl sm:p-12">
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-secondary-container/20 blur-3xl" />
            <div className="relative z-10 max-w-2xl">
              <h2 className="font-display text-[clamp(1.6rem,5vw,2.25rem)] font-bold leading-tight tracking-tight sm:leading-tight">
                Punya Kebutuhan Website? Diskusikan Gratis.
              </h2>
              <p className="mb-8 mt-3 text-base text-surface-container-highest/90">
                Ceritakan bisnis dan kebutuhan website Anda — tim kami akan merespons dan menyusun
                penawaran yang transparan.
              </p>
              <Link
                to="/hubungi-sales?layanan=jasa-website"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-secondary-container px-8 py-4 text-base font-semibold text-on-secondary-fixed shadow-md transition-all hover:brightness-95 sm:w-auto"
              >
                Hubungi Tim Sales
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </Link>
            </div>
          </div>
        </section>

        {/* FAQ JASA */}
        <section id="faq-jasa" className="mx-auto w-full max-w-4xl scroll-mt-20 px-4 pb-20 sm:px-6">
          <div className="mb-12 text-center">
            <span className="mb-2 block text-[13px] font-bold uppercase tracking-widest text-secondary">
              Tanya Jawab Jasa
            </span>
            <h2 className="font-display text-[clamp(1.75rem,5vw,3rem)] font-bold leading-tight tracking-tight text-on-surface">
              Seputar Jasa Website Ordria
            </h2>
          </div>
          <div className="space-y-4">
            {FAQ_JASA.map((f, i) => {
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

      <Footer pos="/pos-kafe" />
    </div>
  )
}
