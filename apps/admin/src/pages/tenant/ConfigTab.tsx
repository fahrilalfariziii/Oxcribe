import { Badge, Button, Card, CardTitle, Field, Input, Select } from '../../components/ui'
import { FEATURE_GROUPS, FLAG_HINTS, KNOWN_FLAGS, rp } from './types'

type FeeMode = 'percent' | 'flat'

type Props = {
  overrides: Record<string, boolean>
  canManageFeatures: boolean
  onToggleFlag: (key: string, value: boolean) => void
  onRemoveFlag: (key: string) => void
  onResetAll: () => void
  feeEnabled: boolean
  setFeeEnabled: (v: boolean) => void
  feeMode: FeeMode
  setFeeMode: (v: FeeMode) => void
  feePercent: string
  setFeePercent: (v: string) => void
  feeFlat: string
  setFeeFlat: (v: string) => void
  feeBearerText: string
  onSaveFee: () => void
}

function FlagRow({
  flag,
  value,
  overridden,
  disabled,
  onToggle,
  onRemove,
}: {
  flag: string
  value: boolean
  overridden: boolean
  disabled: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={overridden && value}
        aria-label={`${flag}: ${overridden ? (value ? 'override aktif' : 'override mati') : 'mengikuti paket'}`}
        disabled={disabled}
        onClick={onToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          overridden && value ? 'bg-slate-900' : 'bg-slate-300'
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            overridden && value ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[13px] font-semibold text-slate-800" title={FLAG_HINTS[flag] ?? flag}>
          {flag}
        </p>
        <p className="truncate text-xs text-slate-500">{FLAG_HINTS[flag] ?? 'Override khusus tenant'}</p>
      </div>
      {overridden ? (
        <Badge status={value ? 'Override ON' : 'Override OFF'} tone={value ? 'green' : 'gray'} />
      ) : (
        <Badge status="Ikuti paket" tone="blue" />
      )}
      {!disabled && overridden && (
        <button
          type="button"
          onClick={onRemove}
          title={`Kembalikan ${flag} ke paket`}
          aria-label={`Kembalikan ${flag} ke paket`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-red-700"
        >
          <span className="material-symbols-outlined text-lg" aria-hidden>delete</span>
        </button>
      )}
    </li>
  )
}

// Konfigurasi: override fitur per grup + section platform fee.
export function ConfigTab(props: Props) {
  const { overrides, canManageFeatures } = props
  const covered = new Set([...KNOWN_FLAGS, 'taxAndFees'])
  const otherKeys = Object.keys(overrides).filter((k) => !covered.has(k))
  const groups = otherKeys.length > 0
    ? [...FEATURE_GROUPS, { title: 'Lainnya', desc: 'Key di luar daftar standar.', flags: otherKeys }]
    : FEATURE_GROUPS

  const pct = Math.min(100, Math.max(0, Number(props.feePercent) || 0))
  const flat = Math.max(0, Number(props.feeFlat) || 0)
  const exSubtotal = 50000
  const exFee = !props.feeEnabled ? 0 : props.feeMode === 'flat' ? Math.round(flat) : Math.round(exSubtotal * (pct / 100))
  const grossCustomer = exSubtotal + exFee
  const netQrisCustomer = grossCustomer - exFee - Math.round(grossCustomer * 0.007)
  const netQrisCafe = exSubtotal - exFee - Math.round(exSubtotal * 0.007)

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle
          action={
            canManageFeatures && Object.keys(overrides).length > 0 ? (
              <Button size="sm" variant="ghost" onClick={props.onResetAll}>
                Reset semua
              </Button>
            ) : undefined
          }
        >
          Override fitur per tenant
        </CardTitle>
        <p className="mt-1 text-xs text-slate-500">
          Di luar paket — key yang tidak diatur tetap mengikuti flag paket. Nyalakan switch untuk membuat
          override, matikan untuk mengubah nilainya, ikon hapus untuk kembali ke paket.
        </p>
        <div className="mt-3 space-y-3">
          {groups.map((g, i) => (
            <details key={g.title} open={i === 0} className="group overflow-hidden rounded-lg ring-1 ring-slate-200">
              <summary className="flex cursor-pointer list-none items-center gap-2 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
                <span className="material-symbols-outlined text-lg transition-transform group-open:rotate-180" aria-hidden>
                  expand_more
                </span>
                {g.title}
                <span className="ml-auto text-xs font-normal text-slate-400">{g.flags.length} flag</span>
              </summary>
              <ul className="space-y-1.5 p-2.5">
                {g.flags.map((f) => {
                  const overridden = Object.prototype.hasOwnProperty.call(overrides, f)
                  const value = overrides[f] === true
                  return (
                    <FlagRow
                      key={f}
                      flag={f}
                      value={value}
                      overridden={overridden}
                      disabled={!canManageFeatures}
                      onToggle={() => props.onToggleFlag(f, overridden ? !value : true)}
                      onRemove={() => props.onRemoveFlag(f)}
                    />
                  )
                })}
              </ul>
            </details>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Platform fee self-order (non-tunai)</CardTitle>
        <p className="mt-1 text-xs text-slate-500">
          Per kafe (hasil kerja sama). Hanya untuk self-order QRIS/transfer — cash & manual tidak kena.
          Siapa yang menanggung adalah keputusan owner (di halaman Pajak & Biaya).
          Perubahan tercatat di audit log; order lama tidak berubah.
        </p>
        <p className="mt-2 text-xs text-slate-600">
          Keputusan owner saat ini: <strong>{props.feeBearerText}</strong>
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={props.feeEnabled}
              onChange={(e) => props.setFeeEnabled(e.target.checked)}
              disabled={!canManageFeatures}
              className="h-4 w-4 accent-slate-900"
            />
            Fee aktif
          </label>
          <Field label="Mode">
            <Select value={props.feeMode} onChange={(e) => props.setFeeMode(e.target.value as FeeMode)} className="h-10" disabled={!canManageFeatures}>
              <option value="percent">Persen dari subtotal</option>
              <option value="flat">Flat per transaksi</option>
            </Select>
          </Field>
          {props.feeMode === 'percent' ? (
            <Field label="Persen (%)">
              <Input value={props.feePercent} onChange={(e) => props.setFeePercent(e.target.value)} inputMode="decimal" placeholder="5" disabled={!canManageFeatures} />
            </Field>
          ) : (
            <Field label="Flat (Rp)">
              <Input value={props.feeFlat} onChange={(e) => props.setFeeFlat(e.target.value)} inputMode="numeric" placeholder="1000" disabled={!canManageFeatures} />
            </Field>
          )}
        </div>
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">Simulasi subtotal {rp(exSubtotal)} · fee {rp(exFee)}</p>
          <p className="mt-1">Bila ditanggung pelanggan: total {rp(grossCustomer)} · bersih QRIS (est.) {rp(netQrisCustomer)}</p>
          <p>Bila ditanggung kafe: total {rp(exSubtotal)} · bersih QRIS (est.) {rp(netQrisCafe)}</p>
        </div>
        {canManageFeatures && (
          <Button size="sm" className="mt-3 h-10" onClick={props.onSaveFee}>
            Simpan platform fee
          </Button>
        )}
      </Card>
    </div>
  )
}
