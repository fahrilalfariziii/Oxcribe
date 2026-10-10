import { Button, Card, CardTitle, Field, Select } from '../../components/ui'
import type { TenantDetail } from './types'

type Props = {
  detail: TenantDetail
  subStatus: string
  planCode: string
  setPlanCode: (v: string) => void
  status: string
  setStatus: (v: string) => void
  onSavePlan: () => void
  onSaveStatus: () => void
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="shrink-0 text-slate-400">{k}</dt>
      <dd className="text-right break-words text-slate-700">{v}</dd>
    </div>
  )
}

// Overview: info bisnis + staff (kolom utama) dan langganan (kolom samping).
export function OverviewTab({
  detail,
  subStatus,
  planCode,
  setPlanCode,
  status,
  setStatus,
  onSavePlan,
  onSaveStatus,
}: Props) {
  const b = detail.business
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardTitle>Info bisnis</CardTitle>
          <dl className="mt-3 space-y-1 text-sm">
            <Row k="Email" v={b.email ?? '—'} />
            <Row k="Telepon" v={b.phone ?? '—'} />
            <Row k="Alamat" v={b.address ?? '—'} />
            <Row k="Slug" v={b.slug ?? '—'} />
          </dl>
        </Card>
        <Card>
          <CardTitle>Staff</CardTitle>
          {detail.staff.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Belum ada staff.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {detail.staff.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <span className="font-medium text-slate-800">{s.name}</span>
                  <span className="text-xs text-slate-400">{s.role} · {s.email}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
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
            <Button size="sm" className="w-full" onClick={onSavePlan}>
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
            <Button size="sm" className="w-full" onClick={onSaveStatus}>
              Simpan status
            </Button>
            <p className="text-xs text-slate-400">Status efektif: <strong className="text-slate-600">{subStatus}</strong></p>
          </div>
        </Card>
      </div>
    </div>
  )
}
