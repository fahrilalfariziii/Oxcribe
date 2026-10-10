import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { Button, Field } from '../../shared/components/ui'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.requestPasswordReset(email.trim())
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim permintaan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-[16px] bg-white p-8 ring-1 ring-[#e4e2dd] shadow-2xs">
        <p className="font-display text-2xl font-semibold">Oxcribe</p>
        <p className="mb-6 text-sm text-muted">Reset password akun owner via link email.</p>

        {sent ? (
          <div className="rounded-lg border border-sage/50 bg-[#b8cda9]/30 px-3 py-2.5 text-xs font-medium text-black">
            Bila email terdaftar sebagai owner, link reset (berlaku 1 jam) sudah dikirim. Periksa
            kotak masuk & folder spam.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="mb-4 rounded-lg border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 px-3 py-2.5 text-xs font-medium text-[#ba1a1a]">
                {error}
              </div>
            )}
            <Field label="Email owner">
              <input
                className="h-11 w-full rounded-[8px] border border-clay bg-white px-3 text-sm outline-none focus:border-black"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@kafe.id"
                type="email"
                autoComplete="email"
                required
              />
            </Field>
            <Button className="mt-6 w-full" type="submit" disabled={busy}>
              {busy ? 'Mengirim…' : 'Kirim Link Reset'}
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
