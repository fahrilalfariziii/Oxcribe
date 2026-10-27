import { Outlet } from 'react-router-dom'
import { PosHeader } from './components/PosHeader'
import { PosThemeProvider, usePosTheme } from '../../lib/pos-theme'

export function PosLayout() {
  return (
    <PosThemeProvider>
      <PosLayoutShell />
    </PosThemeProvider>
  )
}

function PosLayoutShell() {
  const { theme } = usePosTheme()

  return (
    <div data-pos-theme={theme} className="flex min-h-full flex-col bg-white text-black">
      <PosHeader />
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
