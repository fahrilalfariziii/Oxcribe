import { useEffect, useRef, useState } from 'react'
import { useCafe } from '../../../../mock/store'
import { processUploadImage } from '../../../../shared/lib/image'
import { Button, Field, TextInput } from '../../../../shared/components/ui'
import { isFeatureOn } from '../../../../shared/lib/features'
import type { BusinessTheme } from '../../../../shared/types'
import { DEFAULT_THEME, THEME_PRESETS, normalizeTheme } from '../../../../shared/types'
import { IMG } from '../../../../mock/data'

const TITLE_FONTS: { id: BusinessTheme['titleFont']; label: string; className: string }[] = [
  { id: 'display', label: 'Display (Fraunces)', className: 'font-display' },
  { id: 'sans', label: 'Sans (Inter)', className: 'font-sans' },
  { id: 'serif', label: 'Serif', className: 'font-serif' },
]

export function ThemeSettingsPage({ embedded = false }: { embedded?: boolean }) {
  const { business, saveBusinessSettings } = useCafe()
  // Kill-switch tema: preset sekali-klik butuh themePreset, kustom penuh butuh themeCustom.
  const presetOn = isFeatureOn(business, 'themePreset')
  const customOn = isFeatureOn(business, 'themeCustom')
  const [draft, setDraft] = useState<Required<BusinessTheme>>(() => normalizeTheme(business.theme))
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Sinkronkan form saat tema server tiba (jangan timpa saat menyimpan)
  useEffect(() => {
    if (!saving) setDraft(normalizeTheme(business.theme))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.theme])

  function set<K extends keyof Required<BusinessTheme>>(key: K, value: Required<BusinessTheme>[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function applyPreset(id: string) {
    const preset = THEME_PRESETS.find((p) => p.id === id)
    if (preset) setDraft(normalizeTheme({ ...preset.theme, headerImage: draft.headerImage }))
  }

  async function handleHeaderFile(e: React.ChangeEvent<HTMLInputElement>) {
    setPhotoError('')
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const url = await processUploadImage(file)
      setDraft((prev) => ({ ...prev, headerImage: url }))
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Gagal memproses gambar.')
    } finally {
      e.target.value = ''
    }
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await saveBusinessSettings({ theme: normalizeTheme(draft) })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menyimpan tema')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const clean = { ...DEFAULT_THEME }
      setDraft(clean)
      await saveBusinessSettings({ theme: clean })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal mereset tema')
    } finally {
      setSaving(false)
    }
  }

  const headerBg = draft.headerImage || IMG.headerBg
  const pillRadius = draft.radius === 'full' ? 'rounded-full' : 'rounded-[12px]'
  const titleFont = TITLE_FONTS.find((f) => f.id === draft.titleFont)?.className ?? 'font-display'

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Tema & Tampilan</h1>
          <p className="text-stone">Kustomisasi tampilan self-order pelanggan. Tersimpan di server & tersinkron otomatis.</p>
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 rounded-lg bg-[#b8cda9]/30 p-3 text-xs font-semibold text-sage border border-sage/40">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>Tema tersimpan & terkirim ke self-order!</span>
        </div>
      )}
      {saveError && (
        <div className="flex items-center gap-2 rounded-lg bg-[#ba1a1a]/10 p-3 text-xs font-semibold text-[#ba1a1a] border border-[#ba1a1a]/30">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{saveError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5 rounded-[16px] border border-[#c4c7c7] bg-white p-6 shadow-2xs">
          {/* Preset (butuh themePreset) */}
          {presetOn && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone">Preset sekali klik</p>
            <div className="flex flex-wrap gap-2">
              {THEME_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className="flex items-center gap-2 rounded-full border border-clay bg-white px-3 py-2 text-xs font-semibold hover:border-black"
                  title={`Pakai preset ${p.label}`}
                >
                  <span className="flex -space-x-1.5">
                    <span className="size-4 rounded-full border border-white" style={{ background: p.theme.primary }} />
                    <span className="size-4 rounded-full border border-white" style={{ background: p.theme.accent }} />
                  </span>
                  <span>{p.emoji} {p.label}</span>
                </button>
              ))}
            </div>
          </div>
          )}

          {!presetOn && !customOn && (
            <p className="text-sm text-stone">Fitur tema tidak termasuk paket kafe Anda. Hubungi tim sales Ordria untuk upgrade.</p>
          )}

          {/* Warna + header + font (kustom penuh, butuh themeCustom) */}
          {customOn && (
          <>
          {/* Warna */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {([
              { key: 'primary', label: 'Warna Primer (tombol, pill aktif)' },
              { key: 'accent', label: 'Warna Aksen (badge, highlight)' },
              { key: 'pageBg', label: 'Latar Halaman' },
            ] as const).map((f) => (
              <Field key={f.key} label={f.label}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft[f.key] || '#000000'}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-clay bg-white p-1"
                  />
                  <TextInput value={draft[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} placeholder="#rrggbb" />
                </div>
              </Field>
            ))}
          </div>

          {/* Gambar header */}
          <div className="rounded-xl border border-sand bg-cream/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Gambar Header Self-Order</p>
            <div className="mt-2 flex items-center gap-3">
              <img src={headerBg} alt="" className="h-16 w-28 shrink-0 rounded-lg object-cover" />
              <div className="flex flex-wrap gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" className="hidden" onChange={handleHeaderFile} />
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="gap-1.5 text-xs">
                  <span className="material-symbols-outlined text-[16px]">upload</span>
                  <span>Upload</span>
                </Button>
                {draft.headerImage && (
                  <Button type="button" variant="outline" onClick={() => set('headerImage', '')} className="gap-1.5 text-xs">
                    <span>Bawaan</span>
                  </Button>
                )}
              </div>
            </div>
            {photoError && <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{photoError}</p>}
            <div className="mt-3">
              <Field label="URL gambar (opsional — bila tidak upload)">
                <TextInput
                  value={draft.headerImage.startsWith('data:') ? '' : draft.headerImage}
                  onChange={(e) => set('headerImage', e.target.value.trim())}
                  placeholder="https://… (boleh dikosongkan)"
                />
              </Field>
            </div>
            <Field label={`Gelap overlay: ${draft.headerOverlay}%`}>
              <input
                type="range"
                min={0}
                max={80}
                value={draft.headerOverlay}
                onChange={(e) => set('headerOverlay', Number(e.target.value))}
                className="w-full"
              />
            </Field>
          </div>

          {/* Teks & font */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Teks sambutan">
              <TextInput value={draft.welcomeText} onChange={(e) => set('welcomeText', e.target.value)} placeholder="Halo, Selamat Datang!" />
            </Field>
            <Field label="Font judul">
                <select
                  value={draft.titleFont}
                  onChange={(e) => set('titleFont', (e.target.value || 'display') as Required<BusinessTheme>['titleFont'])}
                className="h-10 w-full rounded-lg border border-clay bg-white px-3 text-sm outline-none focus:border-black"
              >
                {TITLE_FONTS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={draft.showTagline} onChange={(e) => set('showTagline', e.target.checked)} className="size-4" />
              Tampilkan tagline
            </label>
            <div className="flex gap-2">
              {(['full', 'rounded'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => set('radius', r)}
                  className={`flex-1 border py-2 text-xs font-bold ${draft.radius === r ? 'border-black bg-black text-white' : 'border-clay bg-white text-stone'} ${r === 'full' ? 'rounded-full' : 'rounded-[12px]'}`}
                >
                  {r === 'full' ? 'Pill (bulat)' : 'Kotak'}
                </button>
              ))}
            </div>
          </div>

          {!customOn && presetOn && (
            <p className="text-xs text-stone">Kustom penuh (warna, gambar, font) hanya tersedia di paket Enterprise. Preset di atas tetap bisa dipakai & disimpan.</p>
          )}
          </>
          )}

          {(presetOn || customOn) && (
          <div className="flex gap-2 border-t border-sand pt-4">
            <Button variant="outline" className="flex-1" onClick={handleReset} disabled={saving}>Reset Default</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? 'Menyimpan…' : 'Simpan Tema'}
            </Button>
          </div>
          )}
        </div>

        {/* Preview HP live */}
        <div className="mx-auto w-full max-w-[320px]">
          <div className="overflow-hidden rounded-[24px] border border-[#c4c7c7] bg-white shadow-2xs">
            <div className="relative">
              <img alt="" className="absolute inset-0 h-full w-full object-cover" src={headerBg} />
              <div className="absolute inset-0 bg-black" style={{ opacity: draft.headerOverlay / 100 }} />
              <div className="relative flex flex-col items-center gap-2 px-5 py-6">
                {business.logoUrl ? (
                  <img src={business.logoUrl} alt={business.name} className="size-14 rounded-full border border-white/30 object-cover" />
                ) : (
                  <div className="flex size-14 items-center justify-center rounded-full text-xl text-white" style={{ background: draft.primary }}>
                    {(business.name || 'B').charAt(0).toUpperCase()}
                  </div>
                )}
                <p className={`text-xl font-bold text-white ${titleFont}`}>{business.name}</p>
                <p className="text-xs font-medium text-white">{draft.welcomeText}</p>
                {draft.showTagline && <p className="text-[11px] italic text-white/80">{business.tagline}</p>}
                <div className={`border border-white/30 px-4 py-1 text-[11px] font-semibold text-white ${pillRadius}`} style={{ background: `${draft.accent}88` }}>
                  Table 04
                </div>
              </div>
            </div>
            <div className="flex gap-2 p-4" style={{ background: draft.pageBg }}>
              <span className={`px-4 py-2 text-xs font-semibold text-white ${pillRadius}`} style={{ background: draft.primary }}>Semua</span>
              <span className={`border border-clay/30 bg-white px-4 py-2 text-xs font-semibold text-soil ${pillRadius}`}>Espresso</span>
              <span className={`flex size-8 items-center justify-center rounded-full text-white`} style={{ background: draft.primary }}>+</span>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-stone">Preview langsung — tersinkron ke HP pelanggan setelah Simpan.</p>
        </div>
      </div>
    </div>
  )
}
