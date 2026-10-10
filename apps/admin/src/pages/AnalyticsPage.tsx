import { useEffect, useState } from 'react'
import { platformApi } from '../lib/platform-api'
import { Alert, Card, CardTitle, PageHeader, Skeleton } from '../components/ui'
import { StatCards } from '../components/StatCards'

type Overview = {
  tenantsPerPlan: { planCode: string | null; count: number }[]
  newTenantsByMonth: { month: string; count: number }[]
  mrr: number
  activeSubscriptions: number
}

export function AnalyticsPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    platformApi
      .getAnalytics()
      .then((res) => setData(res as unknown as Overview))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat'))
  }, [])

  return (
    <section className="space-y-4">
      <PageHeader title="Analitik" desc="Ringkasan kesehatan bisnis platform." />
      {error && <Alert tone="error">{error}</Alert>}
      {!data && !error ? (
        <Skeleton lines={4} />
      ) : data ? (
        <>
          <StatCards
            columns={2}
            stats={[
              { label: 'Estimasi MRR', value: `Rp ${Number(data.mrr).toLocaleString('id-ID')}`, icon: 'payments' },
              { label: 'Langganan Aktif', value: String(data.activeSubscriptions), icon: 'verified' },
            ]}
          />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>Tenant per paket</CardTitle>
              <ul className="mt-3 space-y-2.5">
                {data.tenantsPerPlan.map((r) => {
                  const max = Math.max(1, ...data.tenantsPerPlan.map((x) => x.count))
                  return (
                    <li key={r.planCode ?? 'none'}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium text-slate-700">{r.planCode ?? '(tanpa paket)'}</span>
                        <strong className="tabular-nums text-slate-900">{r.count}</strong>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${r.planCode ?? 'tanpa paket'}: ${r.count} tenant`}>
                        <div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Card>
            <Card>
              <CardTitle>Tenant baru per bulan</CardTitle>
              {data.newTenantsByMonth.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">Belum ada data.</p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {data.newTenantsByMonth.map((r) => {
                    const max = Math.max(1, ...data.newTenantsByMonth.map((x) => x.count))
                    return (
                      <li key={r.month}>
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="font-mono text-xs text-slate-500">{r.month}</span>
                          <strong className="tabular-nums text-slate-900">{r.count}</strong>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${r.month}: ${r.count} tenant baru`}>
                          <div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </section>
  )
}
