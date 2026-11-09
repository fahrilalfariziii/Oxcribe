import { useEffect, useState } from 'react'
import { useCafe } from '../../../../mock/store'
import { Button, Field, TextInput } from '../../../../shared/components/ui'
import type { PaymentMethod, PaymentSettings } from '../../../../shared/types'
import { selfOrderPaymentMethods } from '../../../../shared/lib/payment-policy'

type MethodMeta = { id: PaymentMethod; label: string; sub: string; icon: string }

const METHODS: MethodMeta[] = [
  { id: 'cash', label: 'Tunai (Cash)', sub: 'Manual — bayar di kasir', icon: 'payments' },
  { id: 'qris', label: 'QRIS', sub: 'DOKU dinamis — QR tampil otomatis', icon: 'qr_code' },
]

export function PaymentSettingsPage() {
  const { business, saveBusinessSettings } = useCafe()
  const [enabled, setEnabled] = useState<PaymentMethod[]>(selfOrderPaymentMethods(business.enabledPaymentMethods))
  const [settings, setSettings] = useState<Record<string, PaymentSettings>>((business.paymentSettings as Record<string, PaymentSettings>) ?? {})
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(selfOrderPaymentMethods(business.enabledPaymentMethods))
    setSettings((business.paymentSettings as Record<string, PaymentSettings>) ?? {})
  }, [business.enabledPaymentMethods, business.paymentSettings])

  function toggleMethod(id: PaymentMethod) {
    setError('')
    setEnabled((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id)
        if (next.length === 0) { setError('Minimal 1 metode pembayaran harus aktif'); return prev }
        return next
      }
      return [...prev, id]
    })
  }
  function updateSetting(id: PaymentMethod, patch: Partial<PaymentSettings>) {
    setSettings((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (enabled.length === 0) { setError('Minimal 1 metode pembayaran harus aktif'); return }
    if (saving) return
    // Rekening transfer manual POS tetap disimpan; Self-Order hanya tunai/QRIS.
    const cleanSettings: Record<string, PaymentSettings> = {}
    for (const [id, cfg] of Object.entries(settings)) {
      const { gateway: _g, instruction: _i, acquirer: _a, ...rest } = cfg
      const cleaned: PaymentSettings = { ...rest, gateway: id === 'qris' ? 'doku' : 'manual' }
      cleanSettings[id] = cleaned
    }
    const payload: Record<string, unknown> = { enabledPaymentMethods: enabled, paymentSettings: cleanSettings }
    setSaving(true)
    setError('')
    try {
      await saveBusinessSettings(payload)
      setSaved(true); setTimeout(()=>setSaved(false),2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pembayaran')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Pembayaran</h1>
        <p className="text-stone">Pilih tunai atau QRIS untuk Self-Order. Status QRIS dikonfirmasi server dari pembayaran gateway.</p>
      </div>

      <form onSubmit={handleSave} className="max-w-2xl rounded-[16px] border border-[#c4c7c7] bg-white p-6 shadow-2xs space-y-5">
        <div className="rounded-xl border border-sand bg-cream/40 p-4">
          <h2 className="font-bold text-black">Sumber DOKU (Global)</h2>
          <p className="mt-1 text-xs text-stone">
            Semua tenant memakai akun DOKU Oxcribe (SNAP Direct API).
            {business.dokuConfigured === false && ' QRIS belum tersedia. Hubungi admin sebelum mengaktifkan pembayaran QRIS.'}
          </p>
        </div>

        <div className="border-b border-sand pb-3 pt-2">
          <h2 className="font-bold text-black">Metode Pembayaran</h2>
          <p className="text-xs text-stone">Aktifkan minimal 1. QRIS menggunakan akun merchant pusat; tunai dibayar di kasir.</p>
        </div>

        {saved && <div className="flex items-center gap-2 rounded-lg bg-[#b8cda9]/30 p-3 text-xs font-semibold text-sage border border-sage/40"><span className="material-symbols-outlined text-[18px]">check_circle</span><span>Pengaturan pembayaran berhasil disimpan!</span></div>}
        {error && <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs font-semibold text-[#ba1a1a] border border-red-200"><span className="material-symbols-outlined text-[18px]">error</span><span>{error}</span></div>}

        <div className="space-y-3">
          {METHODS.map((m)=>{
            const isEnabled = enabled.includes(m.id)
            const cfg = settings[m.id] ?? {}
            return (
              <div key={m.id} className={`rounded-xl border p-4 ${isEnabled?'border-black bg-white':'border-sand bg-cream/40'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[20px] text-stone">{m.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-black">{m.label}</p>
                      <p className="text-xs text-stone">{m.sub} {m.id!=='cash' && <span className="ml-1 rounded bg-sage/10 px-1.5 py-0.5 text-[10px] font-bold text-sage">DOKU</span>}</p>
                    </div>
                  </div>
                  <button type="button" onClick={()=>toggleMethod(m.id)} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${isEnabled?'bg-sage':'bg-clay/50'}`}><span className={`inline-block size-5 transform rounded-full bg-white shadow transition ${isEnabled?'translate-x-5':'translate-x-0'}`} /></button>
                </div>

                {isEnabled && (
                  <div className="mt-4 space-y-3 border-t border-sand pt-4">
                    {m.id==='qris' && (
                      <>
                        <p className="rounded-lg bg-cream/60 border border-sand p-3 text-[11px] text-stone">QR bisa di-scan e-wallet apapun (standar BI).</p>
                        <Field label="URL Gambar QRIS Statis Kafe (untuk pembayaran manual di kasir)">
                          <TextInput value={cfg.qrImageUrl ?? ''} onChange={(e)=>updateSetting(m.id, { qrImageUrl: e.target.value })} placeholder="https://…/qris-kafe.png" />
                        </Field>
                      </>
                    )}

                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex justify-end border-t border-sand pt-4">
          <Button type="submit" disabled={saving} className="flex items-center gap-2"><span className="material-symbols-outlined text-[18px]">save</span><span>{saving ? 'Menyimpan…' : 'Simpan Pembayaran'}</span></Button>
        </div>
      </form>
    </div>
  )
}
