import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type PosTheme = 'light' | 'dark'

// Preferensi tema disimpan per perangkat/browser, bukan per bisnis.
// Tema hanya dipasang di root area POS (lihat PosLayout), jadi owner &
// self-order tidak ikut berubah.
const STORAGE_KEY = 'servopay_pos_theme'

function readStoredTheme(): PosTheme {
  if (typeof window === 'undefined') return 'light'
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

interface PosThemeContextValue {
  theme: PosTheme
  setTheme: (theme: PosTheme) => void
}

const PosThemeContext = createContext<PosThemeContextValue | null>(null)

export function PosThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<PosTheme>(readStoredTheme)

  const setTheme = useCallback((next: PosTheme) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // localStorage bisa diblokir (mode privat/kebijakan browser) — tema
      // tetap berlaku untuk sesi ini, hanya tidak tersimpan setelah refresh.
    }
  }, [])

  // Sinkronkan antar-tab POS yang terbuka di perangkat yang sama.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      if (event.newValue === 'light' || event.newValue === 'dark') {
        setThemeState(event.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return <PosThemeContext.Provider value={value}>{children}</PosThemeContext.Provider>
}

export function usePosTheme() {
  const context = useContext(PosThemeContext)
  if (!context) throw new Error('usePosTheme harus dipakai di dalam PosThemeProvider')
  return context
}
