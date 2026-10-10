import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePlatform } from '../auth/PlatformAuth'
import { Alert, Button, Field, Input } from '../components/ui'

export function LoginPage() {
  const { login } = usePlatform()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = params.get('next') || '/platform/tenants'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email.trim(), password)
      navigate(next.startsWith('/platform/') ? next : '/platform/tenants', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <p className="text-lg font-bold tracking-tight text-slate-900">Oxcribe</p>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Platform Admin</p>
        <p className="mb-6 mt-3 text-sm text-slate-500">Internal only — terpisah dari login kasir/owner tenant.</p>
        {error && (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <div className="space-y-4">
          <Field label="Email">
            <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@oxcribe.id" />
          </Field>
          <Field label="Password">
            <Input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
        </div>
        <Button type="submit" disabled={busy} className="mt-6 w-full">
          {busy ? 'Masuk…' : 'Masuk'}
        </Button>
      </form>
    </div>
  )
}
