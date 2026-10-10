import { useState } from 'react'
import { Button, Field, Input, Modal } from '../../components/ui'

type Props = {
  isSuper: boolean
  newPassword: string
  setNewPassword: (v: string) => void
  onReset: () => void
}

// Danger Zone: reset password owner. Hanya superadmin. Konfirmasi via modal.
export function DangerZone({ isSuper, newPassword, setNewPassword, onReset }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  if (!isSuper) return null
  return (
    <section aria-label="Danger Zone" className="rounded-xl bg-red-50/60 p-5 ring-1 ring-red-600/20">
      <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-red-800">
        <span className="material-symbols-outlined text-lg" aria-hidden>warning</span>
        Danger Zone
      </h2>
      <p className="mt-1 text-xs text-red-700/80">
        Reset mengganti password owner secara langsung. Owner yang sedang login akan keluar dan harus login ulang.
      </p>
      <div className="mt-3 grid gap-3 sm:max-w-md">
        <Field label="Password baru owner" hint="Minimal 8 karakter + simbol (divalidasi server)">
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Password baru (min 8 + simbol)"
            autoComplete="new-password"
          />
        </Field>
        <Button
          size="sm"
          variant="danger"
          className="w-full sm:w-auto"
          disabled={!newPassword}
          onClick={() => setConfirmOpen(true)}
        >
          Reset password
        </Button>
      </div>
      {confirmOpen && (
        <Modal
          title="Reset password owner?"
          desc="Password lama langsung tidak berlaku. Lanjutkan?"
          onClose={() => setConfirmOpen(false)}
        >
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirmOpen(false)}>
              Batal
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirmOpen(false)
                onReset()
              }}
            >
              Ya, reset
            </Button>
          </div>
        </Modal>
      )}
    </section>
  )
}
