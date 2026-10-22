import { useEffect, useState } from 'react'
import { useCafe } from '../../../../mock/store'
import { api } from '../../../../lib/api'
import { Button, Field, TextInput } from '../../../../shared/components/ui'

function isStrongPassword(p: string) {
  return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(p)
}

export function ProfileSettingsPage() {
  const { session, upsertStaff, refreshSessionFromBackend } = useCafe()
  const [oldPass, setOldPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profileName, setProfileName] = useState(session?.user.name ?? '')
  const [profileEmail, setProfileEmail] = useState(session?.user.email ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Sinkronkan form saat sesi tiba (hydrate async) — jangan timpa saat menyimpan
  useEffect(() => {
    if (!profileSaving && session) {
      setProfileName(session.user.name ?? '')
      setProfileEmail(session.user.email ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, session?.user.name, session?.user.email])

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!session || profileSaving) return
    if (!profileName.trim() || !profileEmail.trim()) {
      setMsg({ type: 'error', text: 'Nama dan email wajib diisi.' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileEmail.trim())) {
      setMsg({ type: 'error', text: 'Format email tidak valid.' })
      return
    }
    setProfileSaving(true)
    try {
      await upsertStaff(
        { ...session.user, name: profileName.trim(), email: profileEmail.trim(), password: '' },
        false,
      )
      await refreshSessionFromBackend().catch(() => {})
      setMsg({ type: 'success', text: 'Profil tersimpan di server!' })
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Gagal menyimpan profil' })
    } finally {
      setProfileSaving(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!session || saving) return
    if (!oldPass || !newPass || !confirmPass) {
      setMsg({ type: 'error', text: 'Semua field password wajib diisi.' })
      return
    }
    if (newPass !== confirmPass) {
      setMsg({ type: 'error', text: 'Konfirmasi password tidak cocok.' })
      return
    }
    if (!isStrongPassword(newPass)) {
      setMsg({ type: 'error', text: 'Password baru min 8 karakter, harus ada huruf, angka, dan simbol.' })
      return
    }
    setSaving(true)
    try {
      // Verifikasi password lama di server (hash bcrypt) — bukan bandingkan plain lokal.
      await api.changePassword(oldPass, newPass)
      setMsg({ type: 'success', text: 'Password berhasil diperbarui.' })
      setOldPass('')
      setNewPass('')
      setConfirmPass('')
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Gagal mengubah password' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Profil Akun</h1>
        <p className="text-stone">Informasi akun pengguna dan hak akses peran Anda dalam sistem.</p>
      </div>

      <div className="max-w-2xl rounded-[16px] border border-[#c4c7c7] bg-white p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-4 border-b border-sand pb-6">
          <div className="flex size-16 items-center justify-center rounded-full bg-sand font-display text-2xl font-bold text-black">
            {session?.user.name.charAt(0) || 'O'}
          </div>
          <div>
            <h2 className="text-lg font-bold text-black">{session?.user.name || 'Owner Cafe'}</h2>
            <p className="text-xs text-stone">{session?.user.email || 'owner@cafe.com'}</p>
            <span className="mt-1 inline-block rounded-md bg-sage/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sage">
              {session?.user.role || 'Owner'}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-stone">Detail Pengguna</h3>
          <form onSubmit={handleSaveProfile} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama Pengguna">
              <TextInput
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Nama lengkap"
              />
            </Field>
            <Field label="Alamat Email">
              <TextInput
                type="email"
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
                placeholder="nama@beanbrew.id"
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={profileSaving} className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px]">save</span>
                <span>{profileSaving ? 'Menyimpan…' : 'Simpan Profil'}</span>
              </Button>
            </div>
          </form>
        </div>
      </div>

      <form onSubmit={handleChangePassword} className="max-w-2xl rounded-[16px] border border-[#c4c7c7] bg-white p-6 shadow-sm space-y-4">
        <div className="border-b border-sand pb-3">
          <h2 className="font-bold text-black">Ubah Password</h2>
          <p className="text-xs text-stone">Ganti password akun Anda sendiri. Min 8 karakter (huruf + angka + simbol).</p>
        </div>

        {msg && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${
              msg.type === 'success' ? 'border-sage/40 bg-[#b8cda9]/30 text-sage' : 'border-[#ba1a1a]/30 bg-[#ba1a1a]/10 text-[#ba1a1a]'
            }`}
          >
            {msg.text}
          </div>
        )}

        <Field label="Password Lama">
          <div className="relative">
            <input
              type={showOld ? 'text' : 'password'}
              value={oldPass}
              onChange={(e) => setOldPass(e.target.value)}
              placeholder="Masukkan password lama"
              className="h-10 w-full rounded-lg border border-clay bg-white px-3 pr-10 text-sm outline-none focus:border-black"
            />
            <button type="button" onClick={() => setShowOld((v) => !v)} className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-stone hover:bg-sand">
              <span className="material-symbols-outlined text-[18px]">{showOld ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </Field>

        <Field label="Password Baru">
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="Contoh: Baru123!"
              className="h-10 w-full rounded-lg border border-clay bg-white px-3 pr-10 text-sm outline-none focus:border-black"
            />
            <button type="button" onClick={() => setShowNew((v) => !v)} className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-stone hover:bg-sand">
              <span className="material-symbols-outlined text-[18px]">{showNew ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </Field>

        <Field label="Konfirmasi Password Baru">
          <input
            type="password"
            value={confirmPass}
            onChange={(e) => setConfirmPass(e.target.value)}
            placeholder="Ulangi password baru"
            className="h-10 w-full rounded-lg border border-clay bg-white px-3 text-sm outline-none focus:border-black"
          />
        </Field>

        <div className="flex justify-end border-t border-sand pt-4">
          <Button type="submit" disabled={saving} className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px]">lock_reset</span>
            <span>{saving ? 'Menyimpan…' : 'Simpan Password'}</span>
          </Button>
        </div>
      </form>
    </div>
  )
}
