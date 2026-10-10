import type { KeyboardEvent } from 'react'
import type { TenantTabKey } from './types'

const TABS: { key: TenantTabKey; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'dashboard' },
  { key: 'config', label: 'Konfigurasi', icon: 'settings' },
  { key: 'payment', label: 'Pembayaran & Integrasi', icon: 'payments' },
  { key: 'audit', label: 'Audit Log', icon: 'history' },
]

// Navigasi tab local-state (URL /platform/tenants/:id tidak berubah).
export function TenantTabs({ tab, onChange }: { tab: TenantTabKey; onChange: (t: TenantTabKey) => void }) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.key === tab)
    const next = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
    onChange(TABS[next].key)
  }
  return (
    <div
      role="tablist"
      aria-label="Bagian detail tenant"
      onKeyDown={onKeyDown}
      className="flex gap-1 overflow-x-auto border-b border-slate-200"
    >
      {TABS.map((t) => {
        const active = t.key === tab
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors sm:px-4 ${
              active
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            <span className="material-symbols-outlined text-xl" aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
