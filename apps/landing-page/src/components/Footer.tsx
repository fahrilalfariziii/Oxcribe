import { Link } from 'react-router-dom'

// Footer bersama untuk Home, POS, Jasa Website, dan Hubungi Sales.
// `pos` = basis path halaman POS: '' saat di /pos-kafe (anchor lokal),
// '/pos-kafe' dari halaman lain.
export function Footer({ pos }: { pos: string }) {
  const linkCls = 'text-sm text-on-surface-variant transition-colors hover:text-on-surface'
  return (
    <footer className="w-full border-t border-outline-variant/30 bg-surface-container-low">
      <div className="mx-auto max-w-[90rem] px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-10 grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-10 lg:grid-cols-4">
          <div className="flex flex-col gap-4">
            <Link to="/" className="font-display text-xl font-bold tracking-tight text-on-surface">
              Oxcribe
            </Link>
            <p className="max-w-sm text-sm text-on-surface-variant">
              SaaS POS kafe dan jasa pembuatan website profesional.
            </p>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-outline-variant/40 bg-surface-container px-3 py-1 text-[13px] font-semibold text-on-surface">
              <span className="h-2 w-2 animate-pulse rounded-full bg-secondary-container" />
              All Systems Operational
            </span>
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-[15px] font-semibold text-on-surface">Product</span>
            <Link to="/pos-kafe" className={linkCls}>
              Oxcribe POS — SaaS Kafe
            </Link>
            <Link to="/jasa-website" className={linkCls}>
              Jasa Website Oxcribe
            </Link>
            <a href={`${pos}#pricing`} className={linkCls}>
              Paket &amp; Harga POS
            </a>
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-[15px] font-semibold text-on-surface">Perusahaan</span>
            <Link to="/hubungi-sales" className={linkCls}>
              Demo &amp; Konsultasi
            </Link>
            <Link to="/hubungi-sales?layanan=jasa-website" className={linkCls}>
              Konsultasi Jasa Website
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-[15px] font-semibold text-on-surface">Hubungi Kami</span>
            <p className="text-sm text-on-surface-variant">
              Preferensi kontak tercepat melalui WhatsApp sales di halaman konsultasi.
            </p>
            <Link
              to="/hubungi-sales"
              className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-all hover:bg-primary-container"
            >
              Hubungi Sales
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          </div>
        </div>
        <div className="flex flex-col items-center justify-between gap-3 border-t border-outline-variant/30 pt-6 text-xs text-on-surface-variant sm:flex-row">
          <p>© 2026 Oxcribe. Hak cipta dilindungi undang-undang.</p>
          <p>Halaman marketing — Oxcribe.</p>
        </div>
      </div>
    </footer>
  )
}
