import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { platformApi, type TenantRow } from '../lib/platform-api'
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Skeleton, Table, Td } from '../components/ui'
import { StatCards } from '../components/StatCards'
import { TenantCreateSheet } from '../components/TenantCreateSheet'

const STATUSES = ['', 'active', 'past_due', 'suspended', 'canceled']
const PLANS = ['', 'starter', 'pro', 'enterprise']

export function TenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [q, setQ] = useState('')
  const [plan, setPlan] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await platformApi.getTenants({ q: q || undefined, plan: plan || undefined, status: status || undefined })
      setTenants(res.tenants)
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

  return (
    <section className="space-y-4">
      <PageHeader
        title="Tenant"
        desc="Agregat administratif saja — bukan detail struk tenant."
        actions={
          <Button size="sm" onClick={() => setSheetOpen(true)}>
            <span className="material-symbols-outlined text-lg">add</span>
            Tenant Baru
          </Button>
        }
      />
      <TenantCreateSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={(businessId) => {
          setSheetOpen(false)
          navigate(`/platform/tenants/${businessId}`)
        }}
      />
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void load()
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / email / slug…" className="h-10 min-w-44 flex-2" />
          <Select value={plan} onChange={(e) => setPlan(e.target.value)} className="h-10 min-w-40 flex-1">
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p || 'Semua paket'}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 min-w-40 flex-1">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || 'Semua status'}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" className="h-10 shrink-0">
            Filter
          </Button>
        </form>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}
      {!loading && tenants.length > 0 && (
        <StatCards
          columns={4}
          stats={[
            { label: 'Total Tenant', value: tenants.length.toLocaleString('id-ID'), icon: 'store' },
            {
              label: 'Langganan Aktif',
              value: tenants.filter((t) => !t.isPlatformSuspended && t.subscriptionStatus === 'active').length.toLocaleString('id-ID'),
              icon: 'verified',
            },
            {
              label: 'Perlu Perhatian',
              value: tenants.filter((t) => t.isPlatformSuspended || (t.subscriptionStatus !== 'active' && t.subscriptionStatus !== null)).length.toLocaleString('id-ID'),
              icon: 'warning',
            },
            {
              label: 'Order 30 Hari',
              value: tenants.reduce((s, t) => s + Number(t.orders30d || 0), 0).toLocaleString('id-ID'),
              icon: 'shopping_bag',
            },
          ]}
        />
      )}
      {loading ? (
        <Skeleton lines={5} />
      ) : (
        <Table head={['Bisnis', 'Paket', 'Status', 'Order 30 hari', 'Owner']} empty={tenants.length === 0 ? 'Tidak ada tenant.' : undefined}>
          {tenants.map((t) => (
            <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
              <Td>
                <Link to={`/platform/tenants/${t.id}`} className="font-medium text-slate-900 underline">
                  {t.name}
                </Link>
                <p className="font-mono text-xs text-slate-400">{t.slug ?? '—'}</p>
              </Td>
              <Td>{t.planName ?? t.plan ?? '—'}</Td>
              <Td>
                <Badge status={t.isPlatformSuspended ? 'suspended' : (t.subscriptionStatus ?? '—')} />
              </Td>
              <Td className="tabular">{t.orders30d.toLocaleString('id-ID')}</Td>
              <Td className="text-xs text-slate-500">{t.owner?.email ?? '—'}</Td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  )
}
