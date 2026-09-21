import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { usePlatform } from '../auth/PlatformAuth'
import { platformApi } from '../lib/platform-api'
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select, Skeleton } from '../components/ui'

type Detail = {
  business: {
    id: number
    name: string
    slug: string | null
    email: string | null
    phone: string | null
    address: string | null
    status: string
    isPlatformSuspended: boolean
    onboardedAt: string | null
    createdAt: string
    featureOverrides: Record<string, boolean> | null
    platformFee: {
      enabled: boolean
      mode: string
      percent: string | number
      flat: string | number
      bearer: string
    } | null
  }
  plan: { code: string; name: string } | null
  subscriptions: { id: number; status: string; plan: { code: string; name: string } }[]
  staff: { id: number; name: string; email: string; role: string }[]
  usage: { staffCount: number; tableCount: number; orders30d: number; revenue30d: string | number }
  auditLogs: {
    id: number
    action: string
    before: unknown
    after: unknown
    createdAt: string
    platformAdmin: { name: string; email: string } | null
  }[]
}

// Kanon full kill-switch (offlineSync disengaja dikecualikan; taxAndFees lawas hanya alias baca).
const KNOWN_FLAGS = ['selfOrder', 'tableManagement', 'inventory', 'analyticsFull', 'salesType', 'performanceItem', 'exportCsv', 'themePreset', 'themeCustom', 'serviceCharge', 'taxFees']

const FLAG_HINTS: Record<string, string> = {
  selfOrder: 'Checkout QR pelanggan (OFF = order publik 403)',
  tableManagement: 'Tulis meja (tambah/edit/QR/hapus)',
  inventory: 'Seluruh modul bahan & stok',
  analyticsFull: 'Analitik lengkap (OFF = dashboard ringkas, /sales 403)',
  salesType: 'Tab & data Self vs Manual',
  performanceItem: 'Halaman Performa Item',
  exportCsv: 'Tombol ekspor CSV owner',
  themePreset: 'Preset tema sekali-klik',
  themeCustom: 'Kustom penuh tema (warna/font/gambar)',
  serviceCharge: 'Service Charge owner (OFF = service NOL di order baru)',
  taxFees: 'Pajak owner (OFF = pajak NOL di order baru)',
  taxAndFees: 'LEGACY — alias lama, menurunkan ke serviceCharge + taxFees bila keduanya belum diatur',
}

export function TenantDetailPage() {
  const { id } = useParams()
  const { admin } = usePlatform()
  const isSuper = admin?.role === 'superadmin'
  // Keputusan: superadmin + support boleh toggle fitur (backend mengizinkan keduanya).
  const canManageFeatures = admin?.role === 'superadmin' || admin?.role === 'support'
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [planCode, setPlanCode] = useState('')
  const [status, setStatus] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [overrideKey, setOverrideKey] = useState('serviceCharge')
  const [overrideValue, setOverrideValue] = useState('true')
  const [expandedAudit, setExpandedAudit] = useState<number | null>(null)
  // Form platform fee self-order non-tunai (per kafe, hasil kerja sama).
  // Bearer adalah keputusan owner (diatur di halaman Pajak & Biaya owner) — admin tidak mengubahnya.
  const [feeEnabled, setFeeEnabled] = useState(false)
  const [feeMode, setFeeMode] = useState<'percent' | 'flat'>('percent')
  const [feePercent, setFeePercent] = useState('5')
  const [feeFlat, setFeeFlat] = useState('1000')

  async function load() {
    setError('')
    try {
      const res = (await platformApi.getTenant(id!)) as unknown as Detail
      setDetail(res)
      setPlanCode(res.plan?.code ?? '')
      setStatus(res.subscriptions[0]?.status ?? '')
      const pf = res.business.platformFee
      setFeeEnabled(pf?.enabled === true)
      setFeeMode(pf?.mode === 'flat' ? 'flat' : 'percent')
      setFeePercent(String(pf?.percent ?? 5))
      setFeeFlat(String(pf?.flat ?? 1000))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(ok)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aksi gagal')
    }
  }

  if (!detail) {
    return error ? <Alert tone="error">{error}</Alert> : <Skeleton lines={6} />
  }

  const b = detail.business
  const overrides = b.featureOverrides ?? {}
  const subStatus = b.isPlatformSuspended ? 'suspended' : (detail.subscriptions[0]?.status ?? '—')

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{b.name}</h1>
          <p className="font-mono text-xs text-slate-400">
            {b.slug ?? '—'} · bergabung {new Date(b.onboardedAt ?? b.createdAt).toLocaleDateString('id-ID')}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Badge status={detail.plan?.name ?? '—'} tone="blue" />
          <Badge status={subStatus} />
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Order 30 hari" value={Number(detail.usage.orders30d).toLocaleString('id-ID')} />
        <Stat label="Omset 30 hari" value={`Rp ${Number(detail.usage.revenue30d).toLocaleString('id-ID')}`} />
        <Stat label="Staff aktif" value={`${detail.usage.staffCount} akun`} />
        <Stat label="Meja aktif" value={`${detail.usage.tableCount} meja`} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* Kolom utama */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardTitle>Info bisnis</CardTitle>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Row k="Email" v={b.email ?? '—'} />
              <Row k="Telepon" v={b.phone ?? '—'} />
              <Row k="Alamat" v={b.address ?? '—'} />
            </dl>
            <h3 className="mt-4 text-[15px] font-semibold text-slate-900">Staff</h3>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {detail.staff.map((s) => (
                <li key={s.id}>
                  {s.name} <span className="text-slate-400">({s.role} · {s.email})</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardTitle>Override fitur per tenant</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Di luar paket — key yang tidak diatur tetap mengikuti flag paket.
              {FLAG_HINTS[overrideKey] ? ` ${FLAG_HINTS[overrideKey]}.` : ''}
            </p>
            {Object.keys(overrides).length === 0 ? (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">
                Tidak ada override — sepenuhnya mengikuti paket.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-sm">
                {Object.entries(overrides).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="font-mono" title={FLAG_HINTS[k] ?? k}>
                      {k} = <strong>{String(v)}</strong>
                    </span>
                    {canManageFeatures && (
                      <button
                        onClick={() => void act(() => platformApi.updateOverrides(id!, { [k]: null }), `Override ${k} dihapus.`)}
                        className="text-xs font-medium text-red-700 hover:underline"
                      >
                        hapus
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManageFeatures && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Select value={overrideKey} onChange={(e) => setOverrideKey(e.target.value)} className="h-10 w-auto">
                  {KNOWN_FLAGS.map((f) => (
                    <option key={f} value={f} title={FLAG_HINTS[f] ?? f}>
                      {f}
                    </option>
                  ))}
                </Select>
                <Select value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)} className="h-10 w-auto">
                  <option value="true">true</option>
                  <option value="false">false</option>
                </Select>
                <Button
                  size="sm"
                  className="h-10"
                  onClick={() =>
                    void act(
                      () => platformApi.updateOverrides(id!, { [overrideKey]: overrideValue === 'true' }),
                      `Override ${overrideKey} disimpan.`,
                    )
                  }
                >
                  Simpan
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-10"
                  onClick={() => void act(() => platformApi.clearOverrides(id!), 'Semua override dihapus.')}
                >
                  Reset semua
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Platform fee self-order (non-tunai)</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Per kafe (hasil kerja sama). Hanya untuk self-order QRIS/transfer — cash & manual tidak kena.
              Siapa yang menanggung adalah keputusan owner (di halaman Pajak & Biaya).
              Perubahan tercatat di audit log; order lama tidak berubah.
            </p>
            <p className="mt-2 text-xs text-slate-600">
              Keputusan owner saat ini:{' '}
              <strong>{detail.business.platformFee?.bearer === 'cafe' ? 'Ditanggung kafe' : 'Dibayar pelanggan'}</strong>
            </p>
            {(() => {
              const pct = Math.min(100, Math.max(0, Number(feePercent) || 0))
              const flat = Math.max(0, Number(feeFlat) || 0)
              const exSubtotal = 50000
              const exFee = !feeEnabled ? 0 : feeMode === 'flat' ? Math.round(flat) : Math.round(exSubtotal * (pct / 100))
              const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`
              const grossCustomer = exSubtotal + exFee
              const netQrisCustomer = grossCustomer - exFee - Math.round(grossCustomer * 0.007)
              const netQrisCafe = exSubtotal - exFee - Math.round(exSubtotal * 0.007)
              return (
                <>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={feeEnabled} onChange={(e) => setFeeEnabled(e.target.checked)} disabled={!canManageFeatures} />
                      Fee aktif
                    </label>
                    <Field label="Mode">
                      <Select value={feeMode} onChange={(e) => setFeeMode(e.target.value as 'percent' | 'flat')} className="h-10" disabled={!canManageFeatures}>
                        <option value="percent">Persen dari subtotal</option>
                        <option value="flat">Flat per transaksi</option>
                      </Select>
                    </Field>
                    {feeMode === 'percent' ? (
                      <Field label="Persen (%)">
                        <Input value={feePercent} onChange={(e) => setFeePercent(e.target.value)} inputMode="decimal" placeholder="5" disabled={!canManageFeatures} />
                      </Field>
                    ) : (
                      <Field label="Flat (Rp)">
                        <Input value={feeFlat} onChange={(e) => setFeeFlat(e.target.value)} inputMode="numeric" placeholder="1000" disabled={!canManageFeatures} />
                      </Field>
                    )}
                  </div>
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                    <p className="font-semibold text-slate-800">Simulasi subtotal {rp(exSubtotal)} · fee {rp(exFee)}</p>
                    <p className="mt-1">Bila ditanggung pelanggan: total {rp(grossCustomer)} · bersih QRIS (est.) {rp(netQrisCustomer)}</p>
                    <p>Bila ditanggung kafe: total {rp(exSubtotal)} · bersih QRIS (est.) {rp(netQrisCafe)}</p>
                  </div>
                  {canManageFeatures && (
                    <Button
                      size="sm"
                      className="mt-3 h-10"
                      onClick={() =>
                        void act(
                          () =>
                            platformApi.updatePlatformFee(id!, {
                              platformFeeEnabled: feeEnabled,
                              platformFeeMode: feeMode,
                              platformFeePercent: pct,
                              platformFeeFlat: flat,
                            }),
                          'Platform fee disimpan.',
                        )
                      }
                    >
                      Simpan platform fee
                    </Button>
                  )}
                </>
              )
            })()}
          </Card>

          <Card>
            <CardTitle>Riwayat perubahan</CardTitle>
            {detail.auditLogs.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">Belum ada riwayat.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {detail.auditLogs.map((l) => (
                  <li key={l.id} className="py-2.5 first:pt-0 last:pb-0">
                    <button onClick={() => setExpandedAudit(expandedAudit === l.id ? null : l.id)} className="block w-full text-left">
                      <p className="text-sm">
                        <strong className="font-mono text-xs">{l.action}</strong>
                        <span className="text-slate-400"> · {new Date(l.createdAt).toLocaleString('id-ID')}</span>
                      </p>
                      <p className="text-xs text-slate-500">oleh {l.platformAdmin?.name ?? '?'} ({l.platformAdmin?.email ?? '?'})</p>
                    </button>
                    {expandedAudit === l.id && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                        {JSON.stringify({ before: l.before, after: l.after }, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Rel aksi */}
        <div className="space-y-4">
          <Card>
            <CardTitle>Langganan</CardTitle>
            <div className="mt-3 space-y-3">
              <Field label="Paket">
                <Select value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </Select>
              </Field>
              <Button size="sm" className="w-full" onClick={() => void act(() => platformApi.changePlan(id!, planCode), `Paket diubah ke ${planCode}.`)}>
                Simpan paket
              </Button>
              <p className="text-xs text-slate-400">Data historis tidak dihapus saat downgrade.</p>
            </div>
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <Field label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="active">active</option>
                  <option value="past_due">past_due</option>
                  <option value="suspended">suspended</option>
                  <option value="canceled">canceled</option>
                </Select>
              </Field>
              <Button size="sm" className="w-full" onClick={() => void act(() => platformApi.changeStatus(id!, status), `Status diubah ke ${status}.`)}>
                Simpan status
              </Button>
            </div>
          </Card>

          {isSuper && (
            <div className="rounded-xl bg-red-50/60 p-5 ring-1 ring-red-600/20">
              <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-red-800">
                <span className="material-symbols-outlined text-lg">warning</span>
                Danger Zone
              </h2>
              <div className="mt-3 space-y-3">
                <Field label="Reset password owner">
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Password baru (min 8 + simbol)"
                  />
                </Field>
                <Button
                  size="sm"
                  variant="danger"
                  className="w-full"
                  onClick={() =>
                    void act(() => platformApi.resetOwnerPassword(id!, newPassword).then(() => setNewPassword('')), 'Password owner direset.')
                  }
                >
                  Reset password
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="tabular mt-1 text-lg font-bold text-slate-900">{value}</p>
    </Card>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-right text-slate-700">{v}</dd>
    </div>
  )
}
