import { useEffect, useState } from 'react'
import { usePlatform } from '../auth/PlatformAuth'
import { platformApi, type PlanRow } from '../lib/platform-api'
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '../components/ui'

// Kanon full kill-switch (offlineSync disengaja dikecualikan: belum ada endpoint khusus).
const FEATURE_TOGGLES: { key: string; label: string; hint: string }[] = [
  { key: 'selfOrder', label: 'Self-Order QR', hint: 'Checkout pelanggan via QR. OFF = POST orders 403.' },
  { key: 'tableManagement', label: 'Manajemen Meja', hint: 'Tulis meja (tambah/edit/QR/hapus). List tetap boleh.' },
  { key: 'inventory', label: 'Inventory & Stok', hint: 'Seluruh /api/ingredients. OFF = 403 + menu hilang.' },
  { key: 'analyticsFull', label: 'Analitik Lengkap', hint: 'OFF = dashboard ringkas, /sales 403.' },
  { key: 'salesType', label: 'Sales Type', hint: 'Breakdown self vs manual. OFF = tab disembunyikan.' },
  { key: 'performanceItem', label: 'Performa Item', hint: 'Halaman performa menu/kategori/varian.' },
  { key: 'exportCsv', label: 'Export CSV', hint: 'Tombol ekspor laporan owner.' },
  { key: 'themePreset', label: 'Tema Preset', hint: 'Preset sekali-klik self-order.' },
  { key: 'themeCustom', label: 'Tema Kustom', hint: 'Warna/font/gambar custom (Enterprise).' },
  { key: 'taxAndFees', label: 'Pajak & Biaya', hint: 'OFF = menu hilang & total = subtotal murni.' },
]

function readFlags(json: string): Record<string, boolean> {
  try {
    return JSON.parse(json) as Record<string, boolean>
  } catch {
    return {}
  }
}

export function PlansPage() {
  const { admin } = usePlatform()
  // Keputusan: superadmin + support boleh toggle fitur paket.
  const canEdit = admin?.role === 'superadmin' || admin?.role === 'support'
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PlanRow | null>(null)
  const [draft, setDraft] = useState({ name: '', price: '', billingCycle: 'monthly', featureFlags: '', limits: '', isActive: true })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await platformApi.getPlans()
      setPlans(res.plans)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function startEdit(p: PlanRow) {
    setEditing(p)
    setDraft({
      name: p.name,
      price: String(p.price),
      billingCycle: p.billingCycle,
      featureFlags: JSON.stringify(p.featureFlags, null, 2),
      limits: JSON.stringify(p.limits, null, 2),
      isActive: p.isActive,
    })
    setError('')
    setNotice('')
  }

  async function save() {
    if (!editing) return
    setError('')
    setNotice('')
    let featureFlags: Record<string, boolean>
    let limits: Record<string, number | null>
    try {
      featureFlags = JSON.parse(draft.featureFlags) as Record<string, boolean>
      limits = JSON.parse(draft.limits) as Record<string, number | null>
    } catch {
      setError('featureFlags / limits bukan JSON valid')
      return
    }
    try {
      await platformApi.updatePlan(editing.code, {
        name: draft.name,
        price: Number(draft.price),
        billingCycle: draft.billingCycle,
        featureFlags,
        limits,
        isActive: draft.isActive,
      })
      setNotice(`Paket ${editing.code} disimpan — langsung memengaruhi feature gating.`)
      setEditing(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan')
    }
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Paket"
        desc={`3 paket tetap. Perubahan langsung memengaruhi gating semua tenant paket tersebut.${canEdit ? '' : ' (read-only untuk role Anda)'}`}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {loading ? (
        <Skeleton lines={5} />
      ) : (
        <div className="grid items-stretch gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.code} className="flex flex-col">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{p.name}</p>
                <Badge status={p.isActive ? 'active' : 'canceled'} />
              </div>
              <p className="tabular mt-2 text-2xl font-bold text-slate-900">
                {Number(p.price) ? `Rp ${Number(p.price).toLocaleString('id-ID')}` : 'Custom'}
              </p>
              <p className="mt-1 font-mono text-xs text-slate-400">
                {p.code} · {p.billingCycle} · {p.tenantCount ?? 0} tenant
              </p>
              <p className="mt-3 text-xs text-slate-500">
                Flags aktif: {Object.entries(p.featureFlags).filter(([, v]) => v).length} · Limits:{' '}
                <span className="font-mono">{JSON.stringify(p.limits)}</span>
              </p>
              <p className="mt-2 text-xs">
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-semibold ${p.featureFlags?.taxAndFees ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-600/10'}`}>
                  Pajak & Biaya: {p.featureFlags?.taxAndFees ? 'ON' : 'OFF'}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {FEATURE_TOGGLES.filter((f) => f.key !== 'taxAndFees').map((f) => (
                  <span
                    key={f.key}
                    title={f.hint}
                    className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${p.featureFlags?.[f.key] ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20' : 'bg-slate-100 text-slate-400 ring-1 ring-slate-600/10'}`}
                  >
                    {f.key}: {p.featureFlags?.[f.key] ? 'ON' : 'OFF'}
                  </span>
                ))}
              </div>
              {canEdit && (
                <Button size="sm" className="mt-4 w-full" onClick={() => startEdit(p)}>
                  Edit
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {editing && canEdit && (
        <Modal title={`Edit paket ${editing.code}`} desc="Berlaku untuk semua tenant paket ini." onClose={() => setEditing(null)} wide>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nama">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Harga">
              <Input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Siklus">
              <Select value={draft.billingCycle} onChange={(e) => setDraft({ ...draft, billingCycle: e.target.value })}>
                <option value="monthly">monthly</option>
                <option value="yearly">yearly</option>
                <option value="custom">custom</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="featureFlags (JSON)">
              <Textarea value={draft.featureFlags} onChange={(e) => setDraft({ ...draft, featureFlags: e.target.value })} rows={8} spellCheck={false} className="font-mono text-xs" />
            </Field>
            <Field label="limits (JSON, null = tanpa batas)">
              <Textarea value={draft.limits} onChange={(e) => setDraft({ ...draft, limits: e.target.value })} rows={8} spellCheck={false} className="font-mono text-xs" />
            </Field>
          </div>
          <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-sm font-semibold text-slate-700">Toggle fitur (kecuali offlineSync)</p>
            <p className="text-xs text-slate-500">ON/OFF langsung memengaruhi gating semua tenant paket ini. Perubahan tercatat di audit log.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {FEATURE_TOGGLES.map((f) => {
                const flags = readFlags(draft.featureFlags)
                const on = flags[f.key] === true
                return (
                  <label key={f.key} className="flex cursor-pointer items-start gap-2 rounded-lg bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={on}
                      onChange={(e) => {
                        const next = { ...readFlags(draft.featureFlags), [f.key]: e.target.checked }
                        setDraft({ ...draft, featureFlags: JSON.stringify(next, null, 2) })
                      }}
                    />
                    <span>
                      <strong className="font-mono text-xs">{f.key}</strong>
                      <span className="block text-xs font-medium">{f.label}</span>
                      <span className="block text-[11px] text-slate-500">{f.hint}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-500">Catatan JSON</summary>
            <p className="mt-1 text-xs text-slate-500">Toggle di atas menulis ke JSON featureFlags di bawah secara otomatis. Kunci <span className="font-mono">offlineSync</span> disengaja tidak di-gate (belum ada endpoint khusus) — mengubahnya tidak ada efek.</p>
          </details>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
            Paket aktif
          </label>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => void save()}>
              Simpan
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
              Batal
            </Button>
          </div>
        </Modal>
      )}
    </section>
  )
}
