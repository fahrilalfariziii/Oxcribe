import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { Button, Field } from '../../shared/components/ui'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirm) {
      setError('Konfirmasi password tidak sama.')
      return
    }
    setBusy(true)
    try {
      await api.confirmPasswordReset(token, newPassword)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mereset password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-[16px] bg-white p-8 ring-1 ring-[#e4e2dd] shadow-2xs">
        <p className="font-display text-2xl font-semibold">Oxcribe</p>
        <p className="mb-6 text-sm text-muted">Buat password baru untuk akun owner.</p>

        {!token ? (
          <div className="rounded-lg border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 px-3 py-2.5 text-xs font-medium text-[#ba1a1a]">
            Link reset tidak lengkap. Buka link dari email Anda atau minta link baru di halaman lupa
            password.
          </div>
        ) : done ? (
          <div className="rounded-lg border border-sage/50 bg-[#b8cda9]/30 px-3 py-2.5 text-xs font-medium text-black">
            Password berhasil diganti. Silakan login dengan password baru.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="mb-4 rounded-lg border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 px-3 py-2.5 text-xs font-medium text-[#ba1a1a]">
                {error}
              </div>
            )}
            <div className="space-y-4">
              <Field label="Password baru">
                <input
                  className="h-11 w-full rounded-[8px] border border-clay bg-white px-3 text-sm outline-none focus:border-black"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8: huruf, angka, simbol"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </Field>
              <Field label="Konfirmasi password baru">
                <input
                  className="h-11 w-full rounded-[8px] border border-clay bg-white px-3 text-sm outline-none focus:border-black"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Ulangi password baru"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </Field>
            </div>
            <Button className="mt-6 w-full" type="submit" disabled={busy}>
              {busy ? 'Menyimpan…' : 'Simpan Password Baru'}
            </Button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-stone">
          <Link to="/login" className="font-semibold text-black underline">
            Kembali ke login
          </Link>
        </p>
      </div>
    </div>
  )
}
