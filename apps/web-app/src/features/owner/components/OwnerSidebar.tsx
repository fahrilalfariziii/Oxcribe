import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useCafe } from '../../../mock/store'
import { isFeatureOn } from '../../../shared/lib/features'

interface MenuItem {
  to?: string
  label: string
  icon: string
  children?: { to: string; label: string }[]
}

const NAV_ITEMS: MenuItem[] = [
  {
    to: '/backoffice/dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
  },
  {
    label: 'Sales',
    icon: 'payments',
    children: [
      { to: '/backoffice/sales/omset', label: 'Omset' },
      { to: '/backoffice/sales/performa', label: 'Performa Item' },
      { to: '/backoffice/sales/riwayat', label: 'Riwayat Transaksi' },
    ],
  },
  {
    label: 'Menu',
    icon: 'restaurant_menu',
    children: [
      { to: '/backoffice/menu/catalog', label: 'Menu Catalog' },
      { to: '/backoffice/menu/categories', label: 'Kategori Menu' },
      { to: '/backoffice/menu/variants', label: 'Varian & Addons' },
    ],
  },
  {
    to: '/backoffice/tables',
    label: 'Tables',
    icon: 'table_restaurant',
  },
  {
    to: '/backoffice/staff',
    label: 'Staff',
    icon: 'people',
  },
  {
    label: 'Settings',
    icon: 'settings',
    children: [
      { to: '/backoffice/settings/profile', label: 'Profile Akun' },
      { to: '/backoffice/settings/business', label: 'Profile Bisnis' },
      { to: '/backoffice/settings/tax', label: 'Pajak & Biaya' },
      { to: '/backoffice/settings/payment', label: 'Pembayaran' },
    ],
  },
]

export function OwnerSidebar() {
  const { business, logout } = useCafe()
  const navigate = useNavigate()
  // Full kill-switch (kecuali offlineSync): tiap menu mengikuti flag efektif.
  // taxAndFees fail-closed (default OFF); flag lain fail-open bila key hilang.
  // Link Pajak & Biaya ikut tampil bila platform fee menyala (section fee ada di halaman itu).
  const showTax = isFeatureOn(business, 'taxAndFees') || business.platformFeeEnabled === true
  const showTables = isFeatureOn(business, 'tableManagement')
  const showPerforma = isFeatureOn(business, 'performanceItem') && isFeatureOn(business, 'analyticsFull')
  const navItems = NAV_ITEMS.map((item) => {
    if (item.label === 'Sales' && item.children) {
      return { ...item, children: item.children.filter((sub) => (sub.to === '/backoffice/sales/performa' ? showPerforma : true)) }
    }
    if (item.label === 'Settings' && item.children) {
      return { ...item, children: item.children.filter((sub) => (sub.to === '/backoffice/settings/tax' ? showTax : true)) }
    }
    return item
  }).filter((item) => (item.to === '/backoffice/tables' ? showTables : true))

  const [isCollapsed, setIsCollapsed] = useState(false)
  const [openAccordion, setOpenAccordion] = useState<string | null>('Sales')

  function toggleAccordion(label: string) {
    if (isCollapsed) setIsCollapsed(false)
    setOpenAccordion((prev) => (prev === label ? null : label))
  }

  return (
    <aside
      className={`flex flex-col justify-between border-r border-[#e4e2dd] bg-cream p-4 shadow-2xs transition-all duration-300 ease-in-out ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      <div>
        {/* Header Branding & Toggle Button */}
        <div className="mb-6 border-b border-sand pb-4">
          {!isCollapsed ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 overflow-hidden">
                {business.logoUrl ? (
                  <img src={business.logoUrl} alt="Logo" className="size-9 shrink-0 rounded-lg border border-sand object-cover" />
                ) : null}
                <div className="overflow-hidden">
                  <h2 className="font-display text-lg font-bold text-black truncate">{business.name}</h2>
                  <p className="text-xs text-stone">Back Office</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-clay/60 bg-white text-stone hover:border-black hover:text-black transition-colors"
                title="Tutup Panel"
              >
                <span className="material-symbols-outlined text-[20px]">
                  dock_to_left
                </span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              {business.logoUrl ? (
                <img src={business.logoUrl} alt="Logo" className="size-10 rounded-lg border border-sand object-cover" />
              ) : null}
              <button
                type="button"
                onClick={() => setIsCollapsed(false)}
                className="flex size-10 items-center justify-center rounded-lg border border-clay/60 bg-white text-stone hover:border-black hover:text-black transition-colors"
                title="Buka Panel"
              >
                <span className="material-symbols-outlined text-[22px]">dock_to_right</span>
              </button>
            </div>
          )}
        </div>
        {/* Accordion Menu Navigation */}
        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const hasChildren = item.children && item.children.length > 0
            const isOpen = openAccordion === item.label

            if (!hasChildren && item.to) {
              return (
                <NavLink
                  key={item.label}
                  to={item.to}
                  title={isCollapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg py-2.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                      isCollapsed ? 'justify-center px-0' : 'px-4'
                    } ${
                      isActive
                        ? 'bg-black text-white shadow-xs'
                        : 'text-stone hover:bg-sand hover:text-black'
                    }`
                  }
                >
                  <span className="material-symbols-outlined text-[20px] shrink-0">
                    {item.icon}
                  </span>
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              )
            }

            return (
              <div key={item.label} className="space-y-1">
                {/* Accordion Parent Header */}
                <button
                  type="button"
                  onClick={() => toggleAccordion(item.label)}
                  title={isCollapsed ? item.label : undefined}
                  className={`flex w-full items-center justify-between rounded-lg py-2.5 text-xs font-semibold uppercase tracking-wider text-stone hover:bg-sand hover:text-black transition-all ${
                    isCollapsed ? 'justify-center px-0' : 'px-4'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[20px] shrink-0">
                      {item.icon}
                    </span>
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!isCollapsed && (
                    <span className="material-symbols-outlined text-[18px] transition-transform duration-200">
                      {isOpen ? 'expand_less' : 'expand_more'}
                    </span>
                  )}
                </button>

                {/* Accordion Children Dropdown */}
                {!isCollapsed && isOpen && item.children && (
                  <div className="ml-9 space-y-1 border-l-2 border-sand pl-2">
                    {item.children.map((sub) => (
                      <NavLink
                        key={sub.label}
                        to={sub.to}
                        className={({ isActive }) =>
                          `block rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            isActive
                              ? 'bg-black text-white'
                              : 'text-stone hover:bg-sand hover:text-black'
                          }`
                        }
                      >
                        {sub.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </div>

      {/* Logout Footer */}
      <div className="border-t border-sand pt-4">
        <button
          type="button"
          onClick={() => {
            logout()
            navigate('/login')
          }}
          title={isCollapsed ? 'Sign Out' : undefined}
          className={`flex w-full items-center justify-center gap-2 rounded-lg border border-clay bg-white py-2.5 text-xs font-semibold text-[#ba1a1a] hover:bg-[#ba1a1a]/10 transition-colors ${
            isCollapsed ? 'px-0' : 'px-3'
          }`}
        >
          <span className="material-symbols-outlined text-[18px] shrink-0">logout</span>
          {!isCollapsed && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  )
}