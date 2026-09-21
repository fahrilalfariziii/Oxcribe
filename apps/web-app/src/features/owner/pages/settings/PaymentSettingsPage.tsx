import { useEffect, useState } from 'react'
import { useCafe } from '../../../../mock/store'
import { Button } from '../../../../shared/components/ui'
import type { PaymentMethod, PaymentSettings } from '../../../../shared/types'

type MethodMeta = { id: PaymentMethod; label: string; sub: string; icon: string }

const METHODS: MethodMeta[] = [
  { id: 'cash', label: 'Tunai (Cash)', sub: 'Manual — bayar di kasir', icon: 'payments' },
  { id: 'qris', label: 'QRIS', sub: 'DOKU dinamis — QR tampil otomatis', icon: 'qr_code' },
  { id: 'bank_transfer', label: 'Transfer Bank (VA)', sub: 'BCA, Mandiri, BNI, BRI via DOKU', icon: 'account_balance' },
]

export function PaymentSettingsPage() {
  const { business, saveBusinessSettings } = useCafe()
  const [enabled, setEnabled] = useState<PaymentMethod[]>((business.enabledPaymentMethods as PaymentMethod[]) ?? ['cash', 'qris'])
  const [settings, setSettings] = useState<Record<string, PaymentSettings>>((business.paymentSettings as Record<string, PaymentSettings>) ?? {})
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled((business.enabledPaymentMethods as PaymentMethod[]) ?? ['cash', 'qris'])
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
    // Non-cash selalu via DOKU SNAP global — strip field lama agar data bersih.
    const SUPPORTED_BANKS = ['bca', 'mandiri', 'bni', 'bri']
    const cleanSettings: Record<string, PaymentSettings> = {}
    for (const [id, cfg] of Object.entries(settings)) {
      const { gateway: _g, instruction: _i, acquirer: _a, ...rest } = cfg
      const cleaned: PaymentSettings = { ...rest, gateway: id === 'cash' ? 'manual' : 'doku' }
      if (id === 'bank_transfer') {
        type Bank4 = 'bca' | 'mandiri' | 'bni' | 'bri'
        const kept = (cleaned.allowedBanks ?? []).filter((b): b is Bank4 => SUPPORTED_BANKS.includes(b))
        if (kept.length > 0) {
          cleaned.allowedBanks = kept
          if (!cleaned.bank || !kept.includes(cleaned.bank)) cleaned.bank = kept[0]
        } else {
          delete cleaned.allowedBanks
          cleaned.bank = (SUPPORTED_BANKS.includes(cleaned.bank ?? '') ? cleaned.bank : 'bca') as Bank4
        }
      }
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
        <p className="text-stone">Pilih metode yang tampil di Self-Order. QRIS/VA via DOKU tampil otomatis + auto-verifikasi webhook.</p>
      </div>

      <form onSubmit={handleSave} className="max-w-2xl rounded-[16px] border border-[#c4c7c7] bg-white p-6 shadow-2xs space-y-5">
        <div className="rounded-xl border border-sand bg-cream/40 p-4">
          <h2 className="font-bold text-black">Sumber DOKU (Global)</h2>
          <p className="mt-1 text-xs text-stone">
            Semua tenant memakai akun DOKU Ordria (SNAP Direct API).
            {business.dokuConfigured === false && ' Kredensial belum dikonfigurasi — order non-tunai akan tercatat tanpa QR/VA sampai admin mengisi env.'}
          </p>
        </div>

        <div className="border-b border-sand pb-3 pt-2">
          <h2 className="font-bold text-black">Metode Pembayaran</h2>
          <p className="text-xs text-stone">Aktifkan minimal 1. QRIS/VA selalu via DOKU.</p>
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
                      <p className="rounded-lg bg-cream/60 border border-sand p-3 text-[11px] text-stone">QR bisa di-scan e-wallet apapun (standar BI).</p>
                    )}

                    {m.id==='bank_transfer' && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone mb-2"></p>
                        <div className="flex flex-wrap gap-2">
                          {(['bca','mandiri','bni','bri'] as const).map((b)=>{
                            const list = (cfg.allowedBanks as string[] | undefined) ?? (cfg.bank ? [cfg.bank as string] : ['bca'])
                            const active = list.includes(b)
                            return (
                              <button key={b} type="button" onClick={()=>{
                                const cur = (cfg.allowedBanks as string[] | undefined) ?? (cfg.bank ? [cfg.bank as string] : [])
                                const next = active ? cur.filter((x)=>x!==b) : [...cur, b]
                                if (next.length===0) return
                                updateSetting(m.id, { allowedBanks: next as ('bca'|'mandiri'|'bni'|'bri')[], bank: next[0] as 'bca'|'mandiri'|'bni'|'bri' })
                              }} className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${active?'border-black bg-black text-white':'border-clay bg-white text-stone'}`}>{b.toUpperCase()}</button>
                            )
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-stone">Semua bank memakai Virtual Account DOKU (nomor VA unik per transaksi).</p>
                      </div>
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
