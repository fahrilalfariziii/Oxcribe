import { NavLink, useNavigate } from 'react-router-dom'
import { useCafe } from '../../../mock/store'
import { isFeatureOn } from '../../../shared/lib/features'

const NAV = [
  { to: '/frontoffice/orders', label: 'Orders', icon: 'receipt_long', flag: null as string | null },
  { to: '/frontoffice/catalog', label: 'Catalog', icon: 'menu_book', flag: null as string | null },
  { to: '/frontoffice/inventory', label: 'Inventory', icon: 'inventory_2', flag: 'inventory' as string | null },
  { to: '/frontoffice/settings', label: 'Settings', icon: 'settings', flag: null as string | null },
]

export function PosHeader() {
  const {connection, pendingSyncCount, business, session, syncNow } = useCafe()
  const navigate = useNavigate()
  const visibleNav = NAV.filter((item) => (item.flag ? isFeatureOn(business, item.flag) : true))

  return (
    <header className="flex h-16 items-center justify-between border-b border-[#c4c7c7] px-6">
      {/* Brand & Connection Status */}
      <div className="flex items-center gap-3">
        {business.logoUrl ? (
          <img src={business.logoUrl} alt="Logo" className="size-8 rounded-lg border border-sand object-cover" />
        ) : null}
        <div className="flex flex-col">
          <span className="font-display text-lg font-semibold leading-none">{business.name}</span>
          <span className="text-[11px] uppercase tracking-wider text-stone">Front Office</span>
        </div>
        
        <button
          onClick={() => {
            if (pendingSyncCount > 0 || connection === 'offline') {
              syncNow()
            }
          }}
          title={
            pendingSyncCount > 0
              ? 'Klik untuk menyinkronkan transaksi offline'
              : 'Status Koneksi'
          }
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition-all active:scale-95 ${
            connection === 'online'
              ? 'bg-[#b8cda9]/40 text-sage cursor-default'
              : connection === 'syncing'
                ? 'bg-sand text-stone cursor-wait'
                : 'bg-[#ba1a1a]/10 text-[#ba1a1a] hover:bg-[#ba1a1a]/20 cursor-pointer'
          }`}
        >
          <span
            className={`material-symbols-outlined text-[14px] ${
              connection === 'syncing' ? 'animate-spin' : ''
            }`}
          >
            {connection === 'online'
              ? 'cloud_done'
              : connection === 'syncing'
                ? 'sync'
                : 'cloud_off'}
          </span>

          <span>
            {connection}
            {pendingSyncCount > 0 ? ` · ${pendingSyncCount}` : ''}
          </span>
        </button>
      </div>

      {/* Navigation Icons */}
      <nav className="flex items-center gap-4">
        {visibleNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label} // Tooltip bawaan browser saat hover
            className={({ isActive }) =>
              `flex size-10 items-center justify-center rounded-[10px] transition-all ${
                isActive
                  ? 'bg-black text-white shadow-sm'
                  : 'text-stone hover:bg-sand hover:text-black'
              }`
            }
          >
            <span className="material-symbols-outlined text-[22px]">
              {item.icon}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Action Buttons & User Session */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/frontoffice/manual')}
          className="flex items-center gap-1.5 rounded-[12px] bg-black px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white transition-transform active:scale-95"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          <span>New Order</span>
        </button>
        {session && (
          <span className="hidden text-xs font-medium text-stone sm:inline" title={session.user.email}>
            {session.user.name}
          </span>
        )}
      </div>
    </header>
  )
}