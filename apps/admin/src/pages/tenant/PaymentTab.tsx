import { Badge, Button, Card, CardTitle, Input } from '../../components/ui'
import { JsonBlock } from '../../components/JsonBlock'
import { rp } from './types'
import type { SubInfo } from './types'

type Props = {
  subInfo: SubInfo
  isSuper: boolean
  transferAmount: string
  setTransferAmount: (v: string) => void
  onRegister: () => void
  onTransfer: () => void
}

type BalanceAccount = {
  type?: string
  accountNo?: string | number
  balance?: { available?: string | number; reserved?: string | number }
}

const TYPE_META: Record<string, { label: string; icon: string }> = {
  DOKU_MERCHANT_IDR: { label: 'IDR — bisa dicairkan', icon: 'account_balance_wallet' },
  DOKU_MERCHANT_PENDING_IDR: { label: 'Pending — menunggu settlement', icon: 'schedule' },
  DOKU_MERCHANT_POINT: { label: 'Poin — non-tunai', icon: 'stars' },
}

function balanceAccounts(balance: unknown): BalanceAccount[] {
  if (typeof balance !== 'object' || balance === null) return []
  const accounts = (balance as { accounts?: unknown }).accounts
  return Array.isArray(accounts) ? (accounts as BalanceAccount[]) : []
}

function storedAccounts(subAccounts: unknown): { type?: string; currency?: string; accountNo?: string | number }[] {
  return Array.isArray(subAccounts)
    ? (subAccounts as { type?: string; currency?: string; accountNo?: string | number }[])
    : []
}

// Pembayaran & Integrasi: status DOKU, sub-account + saldo, detail teknis (JSON tersembunyi).
export function PaymentTab({ subInfo, isSuper, transferAmount, setTransferAmount, onRegister, onTransfer }: Props) {
  const settlement = subInfo?.settlement ?? {}
  const live = balanceAccounts(subInfo?.balance)
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Status Integrasi</CardTitle>
        {!subInfo?.profileId ? (
          <div className="mt-3">
            <p className="text-sm text-slate-500">
              Belum terdaftar — status: <strong>{subInfo?.subAccountStatus ?? 'none'}</strong>. Charge QRIS/VA
              mengendap ke merchant utama sampai sub-account didaftarkan.
            </p>
            {isSuper && (
              <Button size="sm" className="mt-3 h-10" onClick={onRegister}>
                Daftarkan sub-account DOKU
              </Button>
            )}
          </div>
        ) : (
          <dl className="mt-3 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4 py-1">
              <dt className="shrink-0 text-slate-400">Profile ID</dt>
              <dd className="break-all text-right font-mono text-[13px] text-slate-700">{subInfo.profileId}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-1">
              <dt className="shrink-0 text-slate-400">Status</dt>
              <dd><Badge status={subInfo.subAccountStatus} /></dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="shrink-0 text-slate-400">Rekening settlement</dt>
              <dd className="text-right text-slate-700">
                {settlement.bankAccount ?? '—'}
                {settlement.bankCode ? <span className="text-slate-400"> ({settlement.bankCode})</span> : null}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-1">
              <dt className="shrink-0 text-slate-400">Verifikasi rekening</dt>
              <dd><Badge status={settlement.status ?? '—'} /></dd>
            </div>
          </dl>
        )}
      </Card>

      {subInfo?.profileId && (
        <Card>
          <CardTitle>Sub-Account & Saldo</CardTitle>
          {live.length > 0 ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {live.map((a) => {
                const meta = (a.type && TYPE_META[a.type]) || { label: a.type ?? '—', icon: 'account_balance' }
                return (
                  <li key={String(a.accountNo ?? a.type)} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200/60">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      <span className="material-symbols-outlined text-lg" aria-hidden>{meta.icon}</span>
                      {meta.label}
                    </p>
                    <p className="tabular-nums mt-1 text-lg font-bold text-slate-900">
                      {a.balance?.available != null && a.type !== 'DOKU_MERCHANT_POINT'
                        ? rp(Number(a.balance.available))
                        : String(a.balance?.available ?? '—')}
                    </p>
                    <p className="font-mono text-xs text-slate-400">No. {String(a.accountNo ?? '—')}</p>
                    {Number(a.balance?.reserved ?? 0) > 0 && (
                      <p className="text-xs text-amber-700">Dicadangkan: {String(a.balance?.reserved)}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {storedAccounts(subInfo.subAccounts).map((a) => (
                <li key={String(a.accountNo)} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-slate-700">{a.type}</span>
                  <span className="font-mono text-xs text-slate-500">{a.currency} · {String(a.accountNo)}</span>
                </li>
              ))}
            </ul>
          )}
          {isSuper && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Input
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                inputMode="numeric"
                placeholder="50000"
                aria-label="Nominal pencairan"
                className="h-10 w-36"
              />
              <Button size="sm" className="h-10" onClick={onTransfer}>
                Cairkan ke rekening
              </Button>
              <p className="w-full text-xs text-slate-400">
                Pencairan dari saldo IDR ke rekening settlement. Hasil tercatat di audit log.
              </p>
            </div>
          )}
        </Card>
      )}

      <details className="group overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
          <span className="material-symbols-outlined text-lg transition-transform group-open:rotate-180" aria-hidden>
            expand_more
          </span>
          Technical Details
          <span className="ml-auto text-xs font-normal text-slate-400">respons API mentah</span>
        </summary>
        <div className="space-y-3 border-t border-slate-100 p-4">
          <JsonBlock label="subAccounts (tersimpan)" data={subInfo?.subAccounts ?? null} />
          <JsonBlock label="balance (live inquiry)" data={subInfo?.balance ?? null} />
        </div>
      </details>
    </div>
  )
}
