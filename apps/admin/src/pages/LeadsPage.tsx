import { useEffect, useState } from 'react'
import { platformApi, type LeadRow } from '../lib/platform-api'
import { Alert, Badge, Button, Card, PageHeader, Select, Skeleton } from '../components/ui'
import { StatCards } from '../components/StatCards'

const STATUSES = ['', 'new', 'contacted', 'onboarded', 'rejected']

export function LeadsPage() {
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await platformApi.getLeads(status || undefined)
      setLeads(res.leads)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function setStatusOf(id: number, s: string) {
    try {
      await platformApi.updateLead(id, s)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status')
    }
  }

  return (
    <section className="space-y-4">
      <PageHeader title="Leads" desc="Dari form Hubungi Sales — ditindaklanjuti manual, lalu onboarding." />
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void load()
          }}
          className="flex gap-2"
        >
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-auto">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || 'Semua status'}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" className="h-10">
            Filter
          </Button>
        </form>
      </Card>
      {error && <Alert tone="error">{error}</Alert>}
      {!loading && leads.length > 0 && (
        <StatCards
          columns={4}
          stats={[
            { label: 'Total Leads', value: leads.length.toLocaleString('id-ID'), icon: 'forward_to_inbox' },
            { label: 'Baru', value: leads.filter((l) => l.status === 'new').length.toLocaleString('id-ID'), icon: 'fiber_new' },
            { label: 'Dihubungi', value: leads.filter((l) => l.status === 'contacted').length.toLocaleString('id-ID'), icon: 'call' },
            { label: 'Onboarded', value: leads.filter((l) => l.status === 'onboarded').length.toLocaleString('id-ID'), icon: 'check_circle' },
          ]}
        />
      )}
      {loading ? (
        <Skeleton lines={4} />
      ) : leads.length === 0 ? (
        <Card>
          <p className="py-4 text-center text-sm text-slate-400">Tidak ada lead.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {leads.map((l) => (
            <Card key={l.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">
                  {l.businessName} <span className="font-normal text-slate-400">· {l.ownerName}</span>
                </p>
                <Badge status={l.status} />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {l.email} · {l.phone ?? '—'} · {l.jobRole ?? '—'} · {l.outletCount ?? '—'} · minat:{' '}
                {l.needCategory ?? l.interestedPlan?.name ?? '—'}
              </p>
              {l.message && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">“{l.message}”</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {['contacted', 'onboarded', 'rejected'].map((s) => (
                  <Button key={s} variant="secondary" size="sm" onClick={() => void setStatusOf(l.id, s)}>
                    <span className="material-symbols-outlined text-lg" aria-hidden>arrow_forward</span>
                    {s}
                  </Button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
