import { Card } from './ui'

export type StatItem = { label: string; value: string; icon: string }

// Kartu statistik generik: label + angka utama + ikon. Nilai dan sumber data
// disiapkan pemanggil (agregat client-side maupun dari API).
export function StatCards({ stats, columns }: { stats: StatItem[]; columns?: 2 | 3 | 4 }) {
  const cols = columns ?? (stats.length >= 4 ? 4 : stats.length >= 3 ? 3 : 2)
  const grid =
    cols === 4
      ? 'grid-cols-2 xl:grid-cols-4'
      : cols === 3
        ? 'grid-cols-2 lg:grid-cols-3'
        : 'grid-cols-2'
  return (
    <div className={`grid gap-3 ${grid}`}>
      {stats.map((s) => (
        <Card key={s.label} className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900/[0.06] text-slate-700">
            <span className="material-symbols-outlined text-2xl" aria-hidden>{s.icon}</span>
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium uppercase tracking-wide text-slate-400">{s.label}</span>
            <span className="tabular-nums block truncate text-lg font-bold text-slate-900" title={s.value}>{s.value}</span>
          </span>
        </Card>
      ))}
    </div>
  )
}
