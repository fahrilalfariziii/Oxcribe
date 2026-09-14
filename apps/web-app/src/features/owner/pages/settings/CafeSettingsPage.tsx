import { useEffect, useRef, useState } from 'react'
import { useCafe } from '../../../../mock/store'
import { processUploadImage } from '../../../../shared/lib/image'
import { Button, Field, TextInput } from '../../../../shared/components/ui'
import { canUseTheme } from '../../../../shared/lib/features'
import { ThemeSettingsPage } from './ThemeSettingsPage'

type BusinessTab = 'profil' | 'tema'

export function CafeSettingsPage() {
  const { business, saveBusinessSettings } = useCafe()
  const [activeTab, setActiveTab] = useState<BusinessTab>('profil')
  // Kill-switch tema: tab disembunyikan bila preset & custom dua-duanya OFF.
  const themeOn = canUseTheme(business)
  const tabs = ([
    { id: 'profil', label: 'Profil' },
    ...(themeOn ? [{ id: 'tema', label: 'Tema & Tampilan' } as const] : []),
  ] as const)

  // State Form Profile Bisnis
  const [cafeForm, setCafeForm] = useState({
    name: business.name || '',
    tagline: business.tagline || '',
    address: business.address || '',
    phone: business.phone || '',
    email: business.email || '',
    logoUrl: business.logoUrl || '',
  })

  // State Notifikasi & Logo
  const [isSaved, setIsSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [logoError, setLogoError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Sinkronkan form jika business berubah dari luar
  useEffect(() => {
    setCafeForm({
      name: business.name || '',
      tagline: business.tagline || '',
      address: business.address || '',
      phone: business.phone || '',
      email: business.email || '',
      logoUrl: business.logoUrl || '',
    })
  }, [business])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLogoError('')
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await processUploadImage(file)
      if (result.length > 4 * 1024 * 1024) {
        setLogoError('Hasil encode gambar melebihi 4MB, pilih file lebih kecil.')
        return
      }
      setCafeForm((prev) => ({ ...prev, logoUrl: result }))
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Gagal memproses gambar.')
    } finally {
      // reset input agar bisa pilih file yang sama lagi
      e.target.value = ''
    }
  }

  function handleRemoveLogo() {
    setCafeForm((prev) => ({ ...prev, logoUrl: '' }))
    setLogoError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSaveCafeProfile(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    if (!cafeForm.name.trim()) {
      setSaveError('Nama bisnis wajib diisi.')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      await saveBusinessSettings({
        name: cafeForm.name.trim(),
        tagline: cafeForm.tagline,
        address: cafeForm.address,
        phone: cafeForm.phone,
        email: cafeForm.email || undefined,
        logoUrl: cafeForm.logoUrl || undefined,
      })
      setIsSaved(true)
      setTimeout(() => setIsSaved(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menyimpan profil bisnis')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Profil Bisnis</h1>
        <p className="text-stone">Kelola identitas bisnis yang ditampilkan pada cetakan resi, QR Code, dan header aplikasi.</p>
      </div>

      {/* Kategori: Profil identitas vs Tema & tampilan (tema disembunyikan bila flag OFF) */}
      <div className="flex max-w-2xl gap-2 rounded-lg border border-[#c4c7c7] bg-cream p-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 rounded-md px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
              activeTab === t.id ? 'bg-black text-white shadow-xs' : 'bg-white text-stone hover:text-black border border-sand'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'tema' && themeOn ? (
        <ThemeSettingsPage embedded />
      ) : (
      <form onSubmit={handleSaveCafeProfile} className="max-w-2xl rounded-[16px] border border-[#c4c7c7] bg-white p-6 shadow-2xs space-y-5">
        <div className="border-b border-sand pb-3">
          <h2 className="font-bold text-black text-base">Identitas Bisnis</h2>
          <p className="text-xs text-stone">Ubah rincian informasi bisnis Anda.</p>
        </div>

        {isSaved && (
          <div className="flex items-center gap-2 rounded-lg bg-[#b8cda9]/30 p-3 text-xs font-semibold text-sage border border-sage/40">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            <span>Profil Bisnis berhasil diperbarui!</span>
          </div>
        )}
        {saveError && (
          <div className="flex items-center gap-2 rounded-lg bg-[#ba1a1a]/10 p-3 text-xs font-semibold text-[#ba1a1a] border border-[#ba1a1a]/30">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>{saveError}</span>
          </div>
        )}

        {/* LOGO BISNIS */}
        <div className="rounded-xl border border-sand bg-cream/40 p-4">
          <p className="text-[12px] font-medium tracking-[0.14px] text-soil">Logo Bisnis</p>
          <p className="mt-1 text-xs text-stone">Upload foto untuk logo bisnis. jpg/jpeg/png/heic (iPhone didukung, otomatis dikompres). Tersimpan di server.</p>

          <div className="mt-4 flex items-center gap-4">
            <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-clay bg-white shadow-xs">
              {cafeForm.logoUrl ? (
                <img src={cafeForm.logoUrl} alt="Logo preview" className="h-full w-full object-cover" />
              ) : (
                <span className="material-symbols-outlined text-[36px] text-clay">storefront</span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" className="hidden" onChange={handleFileChange} />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="gap-1.5">
                <span className="material-symbols-outlined text-[18px]">{cafeForm.logoUrl ? 'sync' : 'upload'}</span>
                <span>{cafeForm.logoUrl ? 'Ganti Foto' : 'Upload Foto'}</span>
              </Button>
              {cafeForm.logoUrl && (
                <Button type="button" variant="outline" onClick={handleRemoveLogo} className="gap-1.5 text-[#ba1a1a] border-[#ba1a1a]/30 hover:bg-[#ba1a1a]/10">
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                  <span>Hapus Foto</span>
                </Button>
              )}
            </div>
          </div>

          {logoError && <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{logoError}</p>}
        </div>

        <div className="space-y-4 text-sm">
          <Field label="Nama Bisnis">
            <TextInput
              value={cafeForm.name}
              onChange={(e) => setCafeForm({ ...cafeForm, name: e.target.value })}
              placeholder="Contoh: Kopi Studio"
              required
            />
          </Field>

          <Field label="Tagline / Slogan">
            <TextInput
              value={cafeForm.tagline}
              onChange={(e) => setCafeForm({ ...cafeForm, tagline: e.target.value })}
              placeholder="Contoh: Rasakan Kopi Berkualitas Setiap Hari"
            />
          </Field>

          <Field label="Alamat Lengkap">
            <TextInput
              value={cafeForm.address}
              onChange={(e) => setCafeForm({ ...cafeForm, address: e.target.value })}
              placeholder="Contoh: Jl. Diponegoro No. 123, Garut"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nomor Telepon / WhatsApp">
              <TextInput
                value={cafeForm.phone}
                onChange={(e) => setCafeForm({ ...cafeForm, phone: e.target.value })}
                placeholder="Contoh: 081234567890"
              />
            </Field>

            <Field label="Email Kontak Bisnis">
              <TextInput
                type="email"
                value={cafeForm.email}
                onChange={(e) => setCafeForm({ ...cafeForm, email: e.target.value })}
                placeholder="Contoh: info@kopistudio.com"
              />
            </Field>
          </div>
        </div>

        <div className="flex justify-end border-t border-sand pt-4">
          <Button type="submit" disabled={saving} className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">save</span>
            <span>{saving ? 'Menyimpan…' : 'Simpan Perubahan'}</span>
          </Button>
        </div>
      </form>
      )}
    </div>
  )
}
