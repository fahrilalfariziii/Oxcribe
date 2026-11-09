import { useCafe } from '../../../mock/store'
import { normalizeTheme } from '../../../shared/types'

type Screen = 'menu' | 'cart' | 'payment' | 'status' | 'history'

interface BottomNavProps {
  currentScreen: Screen
  hasActiveOrder: boolean
  onNavigate: (screen: Screen) => void
}

export function BottomNav({ currentScreen, hasActiveOrder, onNavigate }: BottomNavProps) {
  const { business } = useCafe()
  const theme = normalizeTheme(business.theme)
  if (currentScreen === 'payment') return null

  const isMenu = currentScreen === 'menu'
  const isOrder = currentScreen === 'cart' || currentScreen === 'status' || currentScreen === 'history'

  return (
    <nav aria-label="Navigasi Self-Order" className="flex shrink-0 items-center justify-around border-t border-clay/20 bg-white px-6 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1">
      {/* Tombol Menu */}
      <button
        type="button"
        aria-current={isMenu ? 'page' : undefined}
        onClick={() => onNavigate('menu')}
        className="relative flex min-h-11 w-20 flex-col items-center justify-center gap-1 py-1.5 text-xs transition-colors"
      >
        {/* Background Pill (Active Indicator) */}
        {isMenu && (
          <span className="absolute inset-0 rounded-[18px] transition-all" style={{ background: `${theme.accent}55` }} />
        )}

        {/* Ikon & Teks (Selalu di Atas Layer Background) */}
        <span
          className={`material-symbols-outlined z-10 text-[24px] ${
            isMenu ? 'font-bold text-ink' : 'text-soil'
          }`}
        >
          restaurant_menu
        </span>
        <span
          className={`z-10 transition-all ${
            isMenu ? 'font-bold text-ink' : 'text-soil'
          }`}
        >
          Menu
        </span>
      </button>

      {/* Tombol Pesanan */}
      <button
        type="button"
        aria-current={isOrder ? 'page' : undefined}
        onClick={() => onNavigate(hasActiveOrder ? 'status' : 'cart')}
        className="relative flex min-h-11 w-20 flex-col items-center justify-center gap-1 py-1.5 text-xs transition-colors"
      >
        {/* Background Pill (Active Indicator) */}
        {isOrder && (
          <span className="absolute inset-0 rounded-[18px] transition-all" style={{ background: `${theme.accent}55` }} />
        )}

        {/* Ikon & Teks (Selalu di Atas Layer Background) */}
        <span
          className={`material-symbols-outlined z-10 text-[24px] ${
            isOrder ? 'font-bold text-ink' : 'text-soil'
          }`}
        >
          receipt_long
        </span>
        <span
          className={`z-10 transition-all ${
            isOrder ? 'font-bold text-ink' : 'text-soil'
          }`}
        >
          Pesanan
        </span>
      </button>
    </nav>
  )
}
