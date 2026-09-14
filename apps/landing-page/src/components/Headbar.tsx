import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { WEB_APP_URL } from '../lib/api'

export function Headbar() {
  const [scrolled, setScrolled] = useState(false)
  const [productOpen, setProductOpen] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileProductOpen, setMobileProductOpen] = useState(false)
  
  const closeTimer = useRef<number | null>(null)
  const headbarRef = useRef<HTMLElement | null>(null)
  const location = useLocation()
  
  const onPos = location.pathname === '/pos-kafe' || location.pathname.startsWith('/pos-kafe/')
  const onJasa = location.pathname === '/jasa-website'
  const onHome = location.pathname === '/'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Tutup dropdown setiap pindah rute.
  useEffect(() => {
    setProductOpen(false)
    setIsPinned(false)
    setMobileOpen(false)
    setMobileProductOpen(false)
  }, [location.pathname])

  // Kunci scroll body saat drawer mobile terbuka.
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  // Click Outside & Escape Key Handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (headbarRef.current && !headbarRef.current.contains(e.target as Node)) {
        setProductOpen(false)
        setIsPinned(false)
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setProductOpen(false)
        setIsPinned(false)
        setMobileOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', onKey)
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  function scheduleClose() {
    if (isPinned) return
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setProductOpen(false), 120)
  }

  function cancelClose() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function handleProductClick() {
    cancelClose()
    if (productOpen && isPinned) {
      setProductOpen(false)
      setIsPinned(false)
    } else {
      setProductOpen(true)
      setIsPinned(true)
    }
  }

  const anchor = (hash: string) => (onPos ? hash : `/pos-kafe${hash}`)

  return (
    <>
    <header
      ref={headbarRef}
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-surface/85 shadow-[0_1px_12px_rgba(30,19,11,0.08)] backdrop-blur-[16px]'
          : 'bg-surface'
      }`}
    >
      <div className="relative mx-auto flex h-16 max-w-[90rem] items-center justify-between px-4 sm:h-20 sm:px-6 lg:px-8">
        {/* LOGO UNTUK HEADBAR: Diperbesar dari h-9 menjadi h-12 */}
        <Link to="/" aria-label="Oxcribe — beranda" className="transition-transform active:scale-95">
          <img src={`${import.meta.env.BASE_URL}oxcribe.svg`} alt="Oxcribe" className="h-9 w-38 sm:h-12" />
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-10 text-base text-on-surface-variant md:flex">
          <Link
            to="/"
            className={`transition-colors duration-200 hover:text-on-surface ${location.pathname === '/' ? 'font-semibold text-on-surface' : ''}`}
          >
            Home
          </Link>
          <div
            className="relative"
            onMouseEnter={() => {
              cancelClose()
              setProductOpen(true)
            }}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={productOpen}
              onClick={handleProductClick}
              className={`flex items-center gap-1.5 transition-colors duration-200 hover:text-on-surface ${productOpen ? 'font-semibold text-on-surface' : ''}`}
            >
              Product
              <span
                className="material-symbols-outlined text-[20px] transition-transform duration-300 ease-out"
                style={{ transform: productOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              >
                expand_more
              </span>
            </button>
          </div>
          <a
            href={onHome ? '#faq' : onJasa ? '#faq-jasa' : anchor('#faq')}
            className="transition-colors duration-200 hover:text-on-surface"
          >
            FAQ
          </a>
        </nav>

        <div className="flex items-center gap-2 sm:gap-5">
          <a
            href={`${WEB_APP_URL}/login`}
            className="hidden text-base text-on-surface-variant transition-colors duration-200 hover:text-on-surface sm:block"
          >
            Sign In
          </a>
          <Link
            to="/hubungi-sales"
            className="hidden items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-md transition-all duration-200 hover:bg-primary-container hover:shadow-lg active:scale-95 min-[400px]:inline-flex sm:px-6 sm:py-3 sm:text-base"
          >
            Hubungi Sales
          </Link>
          <button
            type="button"
            aria-label={mobileOpen ? 'Tutup menu' : 'Buka menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-on-surface transition-colors hover:bg-surface-container-low active:scale-95 md:hidden"
          >
            <span className="material-symbols-outlined text-[26px]">
              {mobileOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>

        {/* Mega Menu Dropdown — desktop saja */}
        <div
          className={`absolute inset-x-0 top-full z-40 hidden px-4 transition-all duration-300 ease-out origin-top sm:px-6 md:block ${
            productOpen
              ? 'pointer-events-auto opacity-100 translate-y-0 scale-y-100'
              : 'pointer-events-none opacity-0 -translate-y-2 scale-y-95'
          }`}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="overflow-hidden rounded-b-3xl border border-t-0 border-outline-variant/30 bg-surface shadow-[0_16px_40px_rgba(30,19,11,0.14)] backdrop-blur-md">
            {/* Grid Kartu Produk */}
            <div className="grid grid-cols-1 divide-y divide-outline-variant/20 p-4 sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:p-5">
              {/* Item 1: POS Kafe */}
              <Link
                to="/pos-kafe"
                onClick={() => {
                  setProductOpen(false)
                  setIsPinned(false)
                }}
                className="group flex items-start gap-5 rounded-2xl p-4 transition-all duration-200 hover:bg-surface-container-low hover:shadow-sm"
              >
                {/* KOTAK IKON DIPERBESAR: h-14 w-14, Ukuran Font Material Icon: 32px */}
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary shadow-sm transition-transform duration-300 ease-out group-hover:scale-110 group-hover:rotate-3">
                  <span className="material-symbols-outlined text-[32px] text-on-primary">point_of_sale</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-on-surface transition-colors duration-200 group-hover:text-primary">
                      POS Kafe
                    </span>
                    {onPos ? (
                      <span className="rounded-full bg-secondary-fixed px-2.5 py-0.5 text-[10px] font-bold text-on-secondary-fixed">
                        Anda di sini
                      </span>
                    ) : (
                      <span className="rounded-full bg-primary-container/60 px-2.5 py-0.5 text-[10px] font-semibold text-on-primary-container">
                        SaaS
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                    Sistem kasir otomatis, manajemen stok bahan, dan QR Self-Order dalam satu platform.
                  </p>
                </div>
                <span className="material-symbols-outlined shrink-0 text-[22px] text-on-surface-variant transition-transform duration-300 ease-out group-hover:translate-x-1.5 group-hover:text-primary">
                  arrow_forward
                </span>
              </Link>

              {/* Item 2: Jasa Website */}
              <Link
                to="/jasa-website"
                onClick={() => {
                  setProductOpen(false)
                  setIsPinned(false)
                }}
                className="group flex items-start gap-5 rounded-2xl p-4 transition-all duration-200 hover:bg-surface-container-low hover:shadow-sm"
              >
                {/* KOTAK IKON DIPERBESAR: h-14 w-14, Ukuran Font Material Icon: 32px */}
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-secondary-fixed shadow-sm transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-rotate-3">
                  <span className="material-symbols-outlined text-[32px] text-on-secondary-fixed">language</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-on-surface transition-colors duration-200 group-hover:text-primary">
                      Jasa Website Custom
                    </span>
                    {onJasa && (
                      <span className="rounded-full bg-secondary-fixed px-2.5 py-0.5 text-[10px] font-bold text-on-secondary-fixed">
                        Anda di sini
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                    Pembuatan landing page &amp; website profesional terintegrasi khusus untuk bisnis Anda.
                  </p>
                </div>
                <span className="material-symbols-outlined shrink-0 text-[22px] text-on-surface-variant transition-transform duration-300 ease-out group-hover:translate-x-1.5 group-hover:text-primary">
                  arrow_forward
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>

    {/* Backdrop drawer mobile */}
    <div
      aria-hidden={!mobileOpen}
      onClick={() => setMobileOpen(false)}
      className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 md:hidden ${
        mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    />

    {/* Drawer mobile: Home, Product accordion, FAQ, Sign In, CTA */}
    <aside
      aria-label="Menu navigasi mobile"
      className={`fixed inset-y-0 right-0 z-50 flex w-[84vw] max-w-sm flex-col bg-surface shadow-2xl transition-transform duration-300 ease-out md:hidden ${
        mobileOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="flex h-16 items-center justify-between border-b border-outline-variant/30 px-4">
        <span className="font-display text-lg font-bold text-on-surface">Menu</span>
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setMobileOpen(false)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-on-surface hover:bg-surface-container-low active:scale-95"
        >
          <span className="material-symbols-outlined text-[26px]">close</span>
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-4 py-4">
        <Link
          to="/"
          onClick={() => setMobileOpen(false)}
          className="flex min-h-11 items-center rounded-xl px-3 py-3 text-base font-semibold text-on-surface hover:bg-surface-container-low"
        >
          Home
        </Link>
        <button
          type="button"
          aria-expanded={mobileProductOpen}
          onClick={() => setMobileProductOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-3 text-left text-base font-semibold text-on-surface hover:bg-surface-container-low"
        >
          Product
          <span
            className="material-symbols-outlined text-[22px] transition-transform duration-300"
            style={{ transform: mobileProductOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            expand_more
          </span>
        </button>
        <div
          className={`grid transition-all duration-300 ease-out ${
            mobileProductOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-2 py-2 pl-2">
              <Link
                to="/pos-kafe"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 rounded-xl bg-surface-container-low p-3"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary">
                  <span className="material-symbols-outlined text-[24px] text-on-primary">point_of_sale</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-on-surface">
                    POS Kafe {onPos ? '• Anda di sini' : ''}
                  </span>
                  <span className="block truncate text-xs text-on-surface-variant">
                    Kasir, stok & QR Self-Order
                  </span>
                </span>
              </Link>
              <Link
                to="/jasa-website"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 rounded-xl bg-surface-container-low p-3"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary-fixed">
                  <span className="material-symbols-outlined text-[24px] text-on-secondary-fixed">language</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-on-surface">
                    Jasa Website {onJasa ? '• Anda di sini' : ''}
                  </span>
                  <span className="block truncate text-xs text-on-surface-variant">
                    Landing page & web custom
                  </span>
                </span>
              </Link>
            </div>
          </div>
        </div>
        <a
          href={onHome ? '#faq' : onJasa ? '#faq-jasa' : anchor('#faq')}
          onClick={() => setMobileOpen(false)}
          className="flex min-h-11 items-center rounded-xl px-3 py-3 text-base font-semibold text-on-surface hover:bg-surface-container-low"
        >
          FAQ
        </a>
        <a
          href={`${WEB_APP_URL}/login`}
          className="flex min-h-11 items-center rounded-xl px-3 py-3 text-base text-on-surface-variant hover:bg-surface-container-low"
        >
          Sign In
        </a>
      </nav>
      <div className="border-t border-outline-variant/30 p-4">
        <Link
          to="/hubungi-sales"
          onClick={() => setMobileOpen(false)}
          className="inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-6 py-3.5 text-base font-semibold text-on-primary shadow-md active:scale-[0.99]"
        >
          Hubungi Sales
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </Link>
      </div>
    </aside>
    </>
  )
}