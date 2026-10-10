import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { platformApi, type AdminRow, type TenantUserRow } from '../lib/platform-api'
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Skeleton, Table, Td } from '../components/ui'
import { StatCards } from '../components/StatCards'

type TabKey = 'internal' | 'merchant'

// Halaman Pengguna: dua kategori — Internal (platform_admins) dan Merchant
// (users tenant). Read-only; kelola akun tetap lewat endpoint khusus.
export function UsersPage() {
  const [tab, setTab] = useState<TabKey>('internal')
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [users, setUsers] = useState<TenantUserRow[]>([])
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(nextTab: TabKey = tab, nextRole = role, nextQ = q, nextBiz = businessId) {
    setLoading(true)
    setError('')
    try {
      if (nextTab === 'internal') {
        const res = await platformApi.getAdmins({
          role: nextRole || undefined,
          q: nextQ || undefined,
        })
        setAdmins(res.admins)
      } else {
        const res = await platformApi.getUsers({
          role: nextRole || undefined,
          businessId: nextBiz ? Number(nextBiz) : undefined,
          q: nextQ || undefined,
        })
        setUsers(res.users)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setQ('')
    setRole('')
    setBusinessId('')
    setError('')
    void load(tab === 'internal' ? 'internal' : 'merchant', '', '', '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const roleOptions = tab === 'internal' ? ['', 'superadmin', 'support'] : ['', 'owner', 'kasir', 'barista']

  return (
    <section className="space-y-4">
      <PageHeader
        title="Pengguna"
        desc="Internal (tim Oxcribe) dan Merchant (staff tenant). Read-only."
      />
      {error && <Alert tone="error">{error}</Alert>}

      <div role="tablist" aria-label="Kategori pengguna" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {(
          [
            { key: 'internal', label: 'Internal', icon: 'manage_accounts' },
            { key: 'merchant', label: 'Merchant', icon: 'store' },
          ] as { key: TabKey; label: string; icon: string }[]
        ).map((t) => {
          const active = t.key === tab
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
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

      {!loading && tab === 'internal' && admins.length > 0 && (
        <StatCards
          columns={3}
          stats={[
            { label: 'Total Internal', value: admins.length.toLocaleString('id-ID'), icon: 'manage_accounts' },
            { label: 'Superadmin', value: admins.filter((a) => a.role === 'superadmin').length.toLocaleString('id-ID'), icon: 'verified' },
            { label: 'Nonaktif', value: admins.filter((a) => !a.active).length.toLocaleString('id-ID'), icon: 'block' },
          ]}
        />
      )}
      {!loading && tab === 'merchant' && users.length > 0 && (
        <StatCards
          columns={4}
          stats={[
            { label: 'Total Staff', value: users.length.toLocaleString('id-ID'), icon: 'group' },
            { label: 'Owner', value: users.filter((u) => u.role === 'owner').length.toLocaleString('id-ID'), icon: 'storefront' },
            { label: 'Kasir / Barista', value: users.filter((u) => u.role !== 'owner').length.toLocaleString('id-ID'), icon: 'point_of_sale' },
            { label: 'Nonaktif', value: users.filter((u) => !u.active).length.toLocaleString('id-ID'), icon: 'block' },
          ]}
        />
      )}

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void load()
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama / email…"
            aria-label="Cari pengguna"
            className="h-10 min-w-44 flex-1"
          />
          <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter role" className="h-10 w-auto">
            {roleOptions.map((r) => (
              <option key={r} value={r}>{r || 'Semua role'}</option>
            ))}
          </Select>
          {tab === 'merchant' && (
            <Input
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              placeholder="ID tenant"
              aria-label="Filter ID tenant"
              inputMode="numeric"
              className="h-10 w-32"
            />
          )}
          <Button type="submit" size="sm" className="h-10 shrink-0">
            Filter
          </Button>
        </form>
      </Card>

      {loading ? (
        <Skeleton lines={5} />
      ) : tab === 'internal' ? (
        <Table
          head={['Nama', 'Role', 'Status']}
          empty={admins.length === 0 ? 'Tidak ada admin.' : undefined}
        >
          {admins.map((a) => (
            <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
              <Td>
                <span className="font-medium text-slate-900">{a.name}</span>
                <span className="block text-xs text-slate-400">{a.email}</span>
              </Td>
              <Td>
                <Badge status={a.role} tone={a.role === 'superadmin' ? 'blue' : 'gray'} />
              </Td>
              <Td>
                <Badge status={a.active ? 'active' : 'nonaktif'} />
              </Td>
            </tr>
          ))}
        </Table>
      ) : (
        <Table
          head={['Staff', 'Role', 'Tenant', 'Status']}
          empty={users.length === 0 ? 'Tidak ada staff.' : undefined}
        >
          {users.map((u) => (
            <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
              <Td>
                <span className="font-medium text-slate-900">{u.name}</span>
                <span className="block text-xs text-slate-400">{u.email}</span>
              </Td>
              <Td>
                <Badge status={u.role} tone={u.role === 'owner' ? 'blue' : 'gray'} />
              </Td>
              <Td>
                <Link to={`/platform/tenants/${u.businessId}`} className="text-slate-700 underline hover:text-slate-900">
                  {u.business.name}
                </Link>
              </Td>
              <Td>
                <Badge status={u.active ? 'active' : 'nonaktif'} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  )
}
