import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Headbar } from '../components/Headbar'
import { Footer } from '../components/Footer'
import { FALLBACK_HOME, fetchHomeContent, type HomeContent } from '../lib/api'

// Halaman depan: gerbang dua produk Ordria. Copy dari CMS (key "home"),
// fallback hardcode saat backend tak terjangkau.
export function HomePage() {
  const [home, setHome] = useState<HomeContent>(FALLBACK_HOME)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  useEffect(() => {
    let cancelled = false
    fetchHomeContent().then(({ home: h }) => {
      if (!cancelled) setHome(h)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-surface">
      <Headbar />
      <main>
        {/* HERO */}
        <section className="mx-auto w-full max-w-[90rem] overflow-hidden px-4 pb-14 pt-8 sm:px-6 lg:px-8 lg:pb-20 lg:pt-14">
          <div className="relative mx-auto flex max-w-6xl flex-col items-center py-6 text-center sm:py-8">
            <div className="pointer-events-none absolute inset-0 -z-10 scale-95 rounded-3xl bg-gradient-to-tr from-secondary-container/20 via-primary-fixed/30 to-transparent blur-3xl" />
            {home.badge && (
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-secondary/20 bg-secondary-fixed px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-on-secondary-fixed shadow-sm">
                <span className="text-xs font-bold text-secondary">⚡</span>
                {home.badge}
              </div>
            )}
            <h1 className="font-display mb-5 max-w-4xl text-[clamp(2rem,7.5vw,4.25rem)] font-bold leading-[1.1] tracking-tight text-on-surface">
              {home.title}
            </h1>
            {home.subtitle && (
              <p className="mb-8 max-w-2xl text-base leading-relaxed text-on-surface-variant sm:text-lg lg:text-xl">
                {home.subtitle}
              </p>
            )}
          </div>
        </section>

        {/* DUA PRODUK */}
        <section className="mx-auto w-full max-w-[90rem] px-4 pb-20 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
            {home.products.map((p) => (
              <div
                key={p.href}
                className="flex flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-sm transition-shadow hover:shadow-md sm:p-8"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-secondary-fixed/60">
                  <span className="material-symbols-outlined text-[24px] text-on-secondary-fixed">{p.icon}</span>
                </div>
                <h2 className="font-display text-2xl font-bold text-on-surface">{p.title}</h2>
                {p.desc && (
                  <p className="mt-2 flex-1 text-[15px] leading-relaxed text-on-surface-variant">{p.desc}</p>
                )}
                <Link
                  to={p.href}
                  className="mt-6 inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-on-primary shadow-md transition-all hover:bg-primary-container active:scale-95"
                >
                  {p.ctaLabel}
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* CTA GABUNGAN */}
        {(home.cta.title || home.cta.subtitle) && (
          <section className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl bg-primary-container p-6 text-on-primary shadow-2xl sm:p-14">
              <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-secondary-container/20 blur-3xl" />
              <div className="relative z-10 max-w-3xl">
                {home.cta.title && (
                  <h2 className="font-display mb-4 text-[clamp(1.6rem,5vw,2.5rem)] font-bold leading-tight tracking-tight text-on-primary">
                    {home.cta.title}
                  </h2>
                )}
                {home.cta.subtitle && (
                  <p className="font-body-lg text-body-lg text-surface-container-highest/90 mb-8 max-w-xl">
                    {home.cta.subtitle}
                  </p>
                )}
                <Link
                  to="/hubungi-sales"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-secondary px-8 py-4 text-base font-semibold text-on-secondary shadow-md transition-all hover:brightness-95 active:scale-95 sm:w-auto"
                >
                  Hubungi Sales
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </Link>
              </div>
            </div>
          </section>
        )}
        {/* FAQ */}
        {home.faqs.length > 0 && (
          <section id="faq" className="mx-auto w-full max-w-4xl scroll-mt-20 px-4 pb-20 sm:px-6">
            <div className="mb-12 text-center">
              <span className="mb-2 block text-[13px] font-bold uppercase tracking-widest text-secondary">
                Tanya Jawab
              </span>
              <h2 className="font-display text-[clamp(1.6rem,5vw,2.25rem)] font-bold leading-tight tracking-tight text-on-surface">
                Seputar Oxcribe
              </h2>
            </div>
            <div className="space-y-4">
              {home.faqs.map((f, i) => {
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
        )}
      </main>
      <Footer pos="/pos-kafe" />
    </div>
  )
}
