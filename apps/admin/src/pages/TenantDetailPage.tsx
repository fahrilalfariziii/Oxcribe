import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { usePlatform } from '../auth/PlatformAuth'
import { platformApi } from '../lib/platform-api'
import { Alert, Skeleton } from '../components/ui'
import { TenantHeader } from './tenant/TenantHeader'
import { StatCards } from './tenant/StatCards'
import { TenantTabs } from './tenant/TenantTabs'
import { OverviewTab } from './tenant/OverviewTab'
import { DangerZone } from './tenant/DangerZone'
import { ConfigTab } from './tenant/ConfigTab'
import { PaymentTab } from './tenant/PaymentTab'
import { AuditTab } from './tenant/AuditTab'
import type { SubInfo, TenantDetail, TenantTabKey } from './tenant/types'

export function TenantDetailPage() {
  const { id } = useParams()
  const { admin } = usePlatform()
  const isSuper = admin?.role === 'superadmin'
  // Keputusan: superadmin + support boleh toggle fitur (backend mengizinkan keduanya).
  const canManageFeatures = admin?.role === 'superadmin' || admin?.role === 'support'
  const [detail, setDetail] = useState<TenantDetail | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<TenantTabKey>('overview')
  const [planCode, setPlanCode] = useState('')
  const [status, setStatus] = useState('')
  const [newPassword, setNewPassword] = useState('')
  // Form platform fee self-order non-tunai (per kafe, hasil kerja sama).
  // Bearer adalah keputusan owner (diatur di halaman Pajak & Biaya owner) — admin tidak mengubahnya.
  const [feeEnabled, setFeeEnabled] = useState(false)
  const [feeMode, setFeeMode] = useState<'percent' | 'flat'>('percent')
  const [feePercent, setFeePercent] = useState('5')
  const [feeFlat, setFeeFlat] = useState('1000')
  // DOKU Sub-Account (agregator, per tenant) — wallet-as-a-service V2
  const [subInfo, setSubInfo] = useState<SubInfo>(null)
  const [transferAmount, setTransferAmount] = useState('50000')

  async function load() {
    setError('')
    try {
      const res = (await platformApi.getTenant(id!)) as unknown as TenantDetail
      setDetail(res)
      setPlanCode(res.plan?.code ?? '')
      setStatus(res.subscriptions[0]?.status ?? '')
      const pf = res.business.platformFee
      setFeeEnabled(pf?.enabled === true)
      setFeeMode(pf?.mode === 'flat' ? 'flat' : 'percent')
      setFeePercent(String(pf?.percent ?? 5))
      setFeeFlat(String(pf?.flat ?? 1000))
      // DOKU sub-account (non-blocking: saldo bisa gagal bila DOKU timeout)
      try {
        const sub = (await platformApi.getDokuSubAccount(id!)) as unknown as SubInfo
        setSubInfo(sub)
      } catch {
        setSubInfo(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(ok)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aksi gagal')
    }
  }

  if (!detail) {
    return error ? <Alert tone="error">{error}</Alert> : <Skeleton lines={6} />
  }

  const b = detail.business
  const overrides = b.featureOverrides ?? {}
  const subStatus = b.isPlatformSuspended ? 'suspended' : (detail.subscriptions[0]?.status ?? '—')
  const feeBearerText = detail.business.platformFee?.bearer === 'cafe' ? 'Ditanggung kafe' : 'Dibayar pelanggan'

  return (
    <section className="space-y-4">
      <TenantHeader
        tenantId={String(b.id)}
        name={b.name}
        slug={b.slug}
        joinedAt={b.onboardedAt ?? b.createdAt}
        subStatus={subStatus}
        planName={detail.plan?.name ?? '—'}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <StatCards usage={detail.usage} />
      <TenantTabs tab={tab} onChange={setTab} />

      <div role="tabpanel" aria-label={tab}>
        {tab === 'overview' && (
          <div className="space-y-4">
            <OverviewTab
              detail={detail}
              subStatus={subStatus}
              planCode={planCode}
              setPlanCode={setPlanCode}
              status={status}
              setStatus={setStatus}
              onSavePlan={() => void act(() => platformApi.changePlan(id!, planCode), `Paket diubah ke ${planCode}.`)}
              onSaveStatus={() => void act(() => platformApi.changeStatus(id!, status), `Status diubah ke ${status}.`)}
            />
            <DangerZone
              isSuper={isSuper}
              newPassword={newPassword}
              setNewPassword={setNewPassword}
              onReset={() =>
                void act(
                  () => platformApi.resetOwnerPassword(id!, newPassword).then(() => setNewPassword('')),
                  'Password owner direset.',
                )
              }
            />
          </div>
        )}

        {tab === 'config' && (
          <ConfigTab
            overrides={overrides}
            canManageFeatures={canManageFeatures}
            onToggleFlag={(key, value) =>
              void act(() => platformApi.updateOverrides(id!, { [key]: value }), `Override ${key} disimpan.`)
            }
            onRemoveFlag={(key) =>
              void act(() => platformApi.updateOverrides(id!, { [key]: null }), `Override ${key} dihapus.`)
            }
            onResetAll={() => void act(() => platformApi.clearOverrides(id!), 'Semua override dihapus.')}
            feeEnabled={feeEnabled}
            setFeeEnabled={setFeeEnabled}
            feeMode={feeMode}
            setFeeMode={setFeeMode}
            feePercent={feePercent}
            setFeePercent={setFeePercent}
            feeFlat={feeFlat}
            setFeeFlat={setFeeFlat}
            feeBearerText={feeBearerText}
            onSaveFee={() => {
              const pct = Math.min(100, Math.max(0, Number(feePercent) || 0))
              const flat = Math.max(0, Number(feeFlat) || 0)
              return void act(
                () =>
                  platformApi.updatePlatformFee(id!, {
                    platformFeeEnabled: feeEnabled,
                    platformFeeMode: feeMode,
                    platformFeePercent: pct,
                    platformFeeFlat: flat,
                  }),
                'Platform fee disimpan.',
              )
            }}
          />
        )}

        {tab === 'payment' && (
          <PaymentTab
            subInfo={subInfo}
            isSuper={isSuper}
            transferAmount={transferAmount}
            setTransferAmount={setTransferAmount}
            onRegister={() =>
              void act(
                () => platformApi.registerDokuSubAccount(id!),
                'Sub-account DOKU didaftarkan. Charge berikutnya di-routing ke tenant ini.',
              )
            }
            onTransfer={() =>
              void act(
                () => platformApi.transferDokuFunds(id!, { amount: Number(transferAmount) || 0 }),
                'Pencairan diajukan — cek webhook transfer di audit log.',
              )
            }
          />
        )}

        {tab === 'audit' && <AuditTab logs={detail.auditLogs} />}
      </div>
    </section>
  )
}
