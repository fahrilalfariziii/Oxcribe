import { useEffect, useState } from 'react'
import { useCafe } from '../../../../mock/store'
import { isFeatureOn } from '../../../../shared/lib/features'
import { Button, Field } from '../../../../shared/components/ui'

export function TaxSettingsPage() {
  const { business, saveBusinessSettings } = useCafe()
  // Granular admin: section dikunci individu bila flag-nya OFF.
  const svcAllowed = isFeatureOn(business, 'serviceCharge')
  const taxAllowed = isFeatureOn(business, 'taxFees')
  const [form, setForm] = useState({
    taxEnabled: business.taxEnabled ?? false,
    taxLabel: business.taxLabel || 'PB1' as const,
    taxRate: String(business.taxRate ?? 0),
    taxBearer: (business.taxBearer as 'customer' | 'cafe') || 'customer' as const,
    serviceChargeEnabled: business.serviceChargeEnabled ?? false,
    serviceChargeRate: String(business.serviceChargeRate ?? 0),
    serviceChargeMode: (business.serviceChargeMode as 'percent' | 'flat') || 'percent' as const,
    serviceChargeFlat: String(business.serviceChargeFlat ?? 0),
    platformFeeBearer: (business.platformFeeBearer as 'customer' | 'cafe') || 'customer' as const,
  })
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm({
      taxEnabled: business.taxEnabled ?? false,
      taxLabel: business.taxLabel || 'PB1',
      taxRate: String(business.taxRate ?? 0),
      taxBearer: (business.taxBearer as 'customer' | 'cafe') || 'customer',
      serviceChargeEnabled: business.serviceChargeEnabled ?? false,
      serviceChargeRate: String(business.serviceChargeRate ?? 0),
      serviceChargeMode: (business.serviceChargeMode as 'percent' | 'flat') || 'percent',
      serviceChargeFlat: String(business.serviceChargeFlat ?? 0),
      platformFeeBearer: (business.platformFeeBearer as 'customer' | 'cafe') || 'customer',
    })
  }, [business])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const parsedTax = Math.min(100, Math.max(0, Number(form.taxRate) || 0))
    const parsedService = Math.min(100, Math.max(0, Number(form.serviceChargeRate) || 0))
    const parsedServiceFlat = Math.max(0, Number(form.serviceChargeFlat) || 0)
    setSaving(true)
    setSaveError(null)
    try {
      // Hanya kirim field yang flag-nya ON — field terkunci dikirim = 403 dari BE.
      const payload: Record<string, unknown> = {}
      if (svcAllowed) {
        Object.assign(payload, {
          serviceChargeEnabled: form.serviceChargeEnabled,
          serviceChargeRate: parsedService,
          serviceChargeMode: form.serviceChargeMode,
          serviceChargeFlat: parsedServiceFlat,
        })
      }
      if (taxAllowed) {
        Object.assign(payload, {
          taxEnabled: form.taxEnabled,
          taxLabel: form.taxLabel as 'PB1' | 'PBJT' | 'PPN',
          taxRate: parsedTax,
          taxBearer: form.taxBearer,
        })
      }
      if (taxAllowed || feeOn) {
        payload.platformFeeBearer = form.platformFeeBearer
      }
      await saveBusinessSettings(payload)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menyimpan pajak')
    } finally {
      setSaving(false)
    }
  }

  const exampleService = form.serviceChargeMode === 'flat'
    ? (Number(form.serviceChargeFlat) || 0)
    : 50000 * ((Number(form.serviceChargeRate) || 0) / 100)
  const exampleServiceText = form.serviceChargeEnabled
    ? (form.serviceChargeMode === 'flat'
      ? `Rp${Math.round(exampleService).toLocaleString('id-ID')} (flat)`
      : `${form.serviceChargeRate}% = Rp${Math.round(exampleService).toLocaleString('id-ID')}`)
    : '0'
  const exampleBase = 50000 + (form.serviceChargeEnabled ? exampleService : 0)
  const exampleTax = form.taxEnabled ? exampleBase * ((Number(form.taxRate) || 0) / 100) : 0
  const exampleTotalCustomer = 50000 + (form.serviceChargeEnabled ? exampleService : 0) + (form.taxBearer === 'customer' && form.taxEnabled ? exampleTax : 0)
  // Biaya aplikasi hanya bisa diaktifkan/dinonaktifkan oleh Platform Admin.
  // Owner hanya memilih siapa yang menanggung (aktif hanya saat fee menyala).
  const feeOn = business.platformFeeEnabled === true
  const feeAmountText = business.platformFeeMode === 'flat'
    ? `Rp${Math.round(business.platformFeeFlat ?? 0).toLocaleString('id-ID')} per transaksi`
    : `${business.platformFeePercent ?? 0}% dari subtotal`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Pajak & Biaya</h1>
        <p className="text-stone">Kelola pajak layanan dan biaya layanan untuk perhitungan total transaksi.</p>
      </div>

      <form onSubmit={handleSave} className="max-w-2xl rounded-[16px] border border-[#c4c7c7] bg-white p-6 shadow-2xs space-y-5">
        {/* Biaya Layanan Aplikasi — paling atas, di luar pengaktifan pajak.
            Aktif/nonaktif hanya oleh Platform Admin; owner hanya memilih penanggung. */}
        <div className="rounded-xl border border-sand bg-cream/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Biaya layanan aplikasi</p>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${feeOn ? 'bg-sage/20 text-sage' : 'bg-sand text-stone'}`}>
              {feeOn ? `Aktif — ${feeAmountText}` : 'Nonaktif'}
            </span>
          </div>
          <p className="text-xs text-stone">
            {feeOn
              ? 'Berlaku untuk self-order non-tunai. Besaran diatur Platform Admin; Anda memilih siapa yang menanggung.'
              : 'Saat ini tidak ada biaya aplikasi. Bagian ini aktif otomatis bila Platform Admin menyalakan fee untuk kafe Anda.'}
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Dibebankan ke</p>
          <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${!feeOn ? 'opacity-40 pointer-events-none' : ''}`}>
            <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${form.platformFeeBearer === 'customer' ? 'border-black bg-white' : 'border-clay/40 bg-white'}`}>
              <input
                type="radio"
                name="platformFeeBearer"
                value="customer"
                checked={form.platformFeeBearer === 'customer'}
                onChange={() => setForm({ ...form, platformFeeBearer: 'customer' })}
                disabled={!feeOn}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-semibold text-black">Pelanggan</p>
                <p className="text-xs text-stone">Fee ditambah di atas total self-order non-tunai.</p>
              </div>
            </label>
            <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${form.platformFeeBearer === 'cafe' ? 'border-black bg-white' : 'border-clay/40 bg-white'}`}>
              <input
                type="radio"
                name="platformFeeBearer"
                value="cafe"
                checked={form.platformFeeBearer === 'cafe'}
                onChange={() => setForm({ ...form, platformFeeBearer: 'cafe' })}
                disabled={!feeOn}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-semibold text-black">Kafe</p>
                <p className="text-xs text-stone">Fee ditanggung kafe (mengurangi pendapatan bersih).</p>
              </div>
            </label>
          </div>
        </div>

        <div className="border-b border-sand pb-3">
          <h2 className="font-bold text-black">Service Charge</h2>
          <p className="text-xs text-stone">Berdiri sendiri — tidak terpengaruh pajak aktif/nonaktif. Selalu ditambah ke total pelanggan.</p>
        </div>

        {!svcAllowed && (
          <div className="flex items-center gap-2 rounded-lg bg-sand/40 p-3 text-xs font-semibold text-stone border border-clay/40">
            <span className="material-symbols-outlined text-[18px]">lock</span>
            <span>Service Charge belum aktif untuk kafe Anda. Hubungi tim admin Ordria untuk mengaktifkan.</span>
          </div>
        )}

        {/* Toggle Service Charge — milik owner, butuh flag serviceCharge dari admin */}
        <div className={`flex items-center justify-between rounded-xl border border-sand bg-cream/40 p-4 ${!svcAllowed ? 'opacity-40 pointer-events-none' : ''}`}>
          <div>
            <p className="text-sm font-semibold text-black">Aktifkan Service Charge</p>
            <p className="text-xs text-stone">Jika dimatikan, service tidak dihitung sama sekali.</p>
          </div>
          <button
            type="button"
            onClick={() => setForm({ ...form, serviceChargeEnabled: !form.serviceChargeEnabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form.serviceChargeEnabled ? 'bg-sage' : 'bg-clay/50'}`}
          >
            <span className={`inline-block size-5 transform rounded-full bg-white shadow transition ${form.serviceChargeEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className={`rounded-xl border border-sand bg-cream/40 p-4 space-y-3 ${!form.serviceChargeEnabled || !svcAllowed ? 'opacity-40 pointer-events-none' : ''}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Mode perhitungan</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${form.serviceChargeMode === 'percent' ? 'border-black bg-white' : 'border-clay/40 bg-white'}`}>
              <input
                type="radio"
                name="serviceChargeMode"
                value="percent"
                checked={form.serviceChargeMode === 'percent'}
                onChange={() => setForm({ ...form, serviceChargeMode: 'percent' })}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-semibold text-black">Persen</p>
                <p className="text-xs text-stone">% dari subtotal.</p>
              </div>
            </label>
            <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${form.serviceChargeMode === 'flat' ? 'border-black bg-white' : 'border-clay/40 bg-white'}`}>
              <input
                type="radio"
                name="serviceChargeMode"
                value="flat"
                checked={form.serviceChargeMode === 'flat'}
                onChange={() => setForm({ ...form, serviceChargeMode: 'flat' })}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-semibold text-black">Flat</p>
                <p className="text-xs text-stone">Nominal Rp per transaksi.</p>
              </div>
            </label>
          </div>
          {form.serviceChargeMode === 'percent' ? (
            <Field label="Service Charge (%)">
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={form.serviceChargeRate}
                onChange={(e) => setForm({ ...form, serviceChargeRate: e.target.value })}
                placeholder="5"
                disabled={!form.serviceChargeEnabled}
                className="h-10 w-full rounded-lg border border-clay bg-white px-3 text-sm outline-none focus:border-black disabled:bg-sand/40"
              />
            </Field>
          ) : (
            <Field label="Service Charge (Rp)">
              <input
                type="number"
                min={0}
                step={500}
                value={form.serviceChargeFlat}
                onChange={(e) => setForm({ ...form, serviceChargeFlat: e.target.value })}
                placeholder="2000"
                disabled={!form.serviceChargeEnabled}
                className="h-10 w-full rounded-lg border border-clay bg-white px-3 text-sm outline-none focus:border-black disabled:bg-sand/40"
              />
            </Field>
          )}
        </div>

        <div className="border-b border-sand pb-3">
          <h2 className="font-bold text-black">Pajak & Biaya Layanan</h2>
          <p className="text-xs text-stone">Atur PB1/PBJT/PPN dan Service Charge. Diterapkan otomatis: subtotal + service → pajak.</p>
        </div>

        {!taxAllowed && (
          <div className="flex items-center gap-2 rounded-lg bg-sand/40 p-3 text-xs font-semibold text-stone border border-clay/40">
            <span className="material-symbols-outlined text-[18px]">lock</span>
            <span>Pajak belum aktif untuk kafe Anda. Hubungi tim admin Ordria untuk mengaktifkan.</span>
          </div>
        )}

        {saved && (
          <div className="flex items-center gap-2 rounded-lg bg-[#b8cda9]/30 p-3 text-xs font-semibold text-sage border border-sage/40">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            <span>Pengaturan pajak berhasil disimpan!</span>
          </div>
        )}
        {saveError && (
          <div className="flex items-center gap-2 rounded-lg bg-[#ba1a1a]/10 p-3 text-xs font-semibold text-[#ba1a1a] border border-[#ba1a1a]/30">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>{saveError}</span>
          </div>
        )}

        {/* Toggle Pajak */}
        <div className={`flex items-center justify-between rounded-xl border border-sand bg-cream/40 p-4 ${!taxAllowed ? 'opacity-40 pointer-events-none' : ''}`}>
          <div>
            <p className="text-sm font-semibold text-black">Aktifkan Pajak</p>
            <p className="text-xs text-stone">Jika dimatikan, pajak tidak dihitung sama sekali.</p>
          </div>
          <button
            type="button"
            onClick={() => setForm({ ...form, taxEnabled: !form.taxEnabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form.taxEnabled ? 'bg-sage' : 'bg-clay/50'}`}
          >
            <span className={`inline-block size-5 transform rounded-full bg-white shadow transition ${form.taxEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Opsi Beban Pajak */}
        <div className={`rounded-xl border border-sand bg-cream/40 p-4 space-y-3 ${!form.taxEnabled || !taxAllowed ? 'opacity-40 pointer-events-none' : ''}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Pajak dibebankan ke</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${form.taxBearer === 'customer' ? 'border-black bg-white' : 'border-clay/40 bg-white'}`}>
              <input
                type="radio"
                name="taxBearer"
                value="customer"
                checked={form.taxBearer === 'customer'}
                onChange={() => setForm({ ...form, taxBearer: 'customer' })}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-semibold text-black">Pelanggan</p>
                <p className="text-xs text-stone">Pelanggan membayar pajak (total + pajak).</p>
              </div>
            </label>
            <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${form.taxBearer === 'cafe' ? 'border-black bg-white' : 'border-clay/40 bg-white'}`}>
              <input
                type="radio"
                name="taxBearer"
                value="cafe"
                checked={form.taxBearer === 'cafe'}
                onChange={() => setForm({ ...form, taxBearer: 'cafe' })}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-semibold text-black">Kafe</p>
                <p className="text-xs text-stone">Pajak ditanggung kafe (pelanggan bayar tanpa pajak).</p>
              </div>
            </label>
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${!form.taxEnabled || !taxAllowed ? 'opacity-40 pointer-events-none' : ''}`}>
          <Field label="Jenis Pajak">
            <select
              value={form.taxLabel}
              onChange={(e) => setForm({ ...form, taxLabel: e.target.value as 'PB1' | 'PBJT' | 'PPN' })}
              className="h-10 w-full rounded-lg border border-clay bg-white px-3 text-sm font-medium outline-none focus:border-black"
              disabled={!form.taxEnabled}
            >
              <option value="PB1">PB1</option>
              <option value="PBJT">PBJT</option>
              <option value="PPN">PPN</option>
            </select>
          </Field>
          <Field label={`${form.taxLabel} (%)`}>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={form.taxRate}
              onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
              placeholder="10"
              disabled={!form.taxEnabled}
              className="h-10 w-full rounded-lg border border-clay bg-white px-3 text-sm outline-none focus:border-black disabled:bg-sand/40"
            />
          </Field>
        </div>
        <p className="text-[11px] text-stone">
          Contoh: Subtotal Rp50.000 → Service {exampleServiceText} → {form.taxEnabled ? `${form.taxLabel} ${form.taxRate}% = Rp${Math.round(exampleTax).toLocaleString('id-ID')}` : 'Pajak 0'} →{' '}
          {form.taxBearer === 'customer' && form.taxEnabled ? `Total Rp${Math.round(exampleTotalCustomer).toLocaleString('id-ID')} (pelanggan)` : `Pelanggan bayar Rp${Math.round(50000 + (form.serviceChargeEnabled ? exampleService : 0)).toLocaleString('id-ID')}, kafe tanggung Rp${Math.round(exampleTax).toLocaleString('id-ID')}`}
        </p>

        <div className="flex justify-end border-t border-sand pt-4">
          <Button type="submit" disabled={saving} className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">save</span>
            <span>{saving ? 'Menyimpan…' : 'Simpan Pajak'}</span>
          </Button>
        </div>
      </form>
    </div>
  )
}
