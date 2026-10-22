import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { formatRupiah } from '../../../shared/lib/format'

interface WalletData {
  wallet: {
    id: number
    availableBalance: number
    pendingBalance: number
    bankCode?: string | null
    bankAccount?: string | null
    accountName?: string | null
    isBankVerified: boolean
    bankVerifiedAt?: string | null
    autoPayoutEnabled: boolean
    payoutFrequency: string
    payoutDay?: number | null
    minimumPayout: number
    holdMinBalance: number
  }
  transactions: Array<{
    id: number
    type: string
    amount: number
    balanceBefore: number
    balanceAfter: number
    referenceId?: string | null
    description?: string | null
    createdAt: string
  }>
  payouts: Array<{
    id: number
    requestNumber: string
    source: string
    amount: number
    bankCode: string
    bankAccount: string
    accountName: string
    status: string
    rejectionReason?: string | null
    bankRefNumber?: string | null
    proofImageUrl?: string | null
    createdAt: string
    processedAt?: string | null
  }>
}

const SUPPORTED_BANKS = [
  { code: '014', name: 'BCA (Bank Central Asia)' },
  { code: '002', name: 'BRI (Bank Rakyat Indonesia)' },
  { code: '008', name: 'Mandiri' },
  { code: '009', name: 'BNI (Bank Negara Indonesia)' },
  { code: '022', name: 'CIMB Niaga' },
  { code: '013', name: 'Permata Bank' },
  { code: '011', name: 'Danamon' },
  { code: '451', name: 'BSI (Bank Syariah Indonesia)' },
]

export function WalletPage() {
  const [data, setData] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'payouts' | 'transactions'>('payouts')

  // Form Tarik Dana Modal
  const [showPayoutModal, setShowPayoutModal] = useState(false)
  const [payoutAmount, setPayoutAmount] = useState('')
  const [payoutSubmitting, setPayoutSubmitting] = useState(false)
  const [payoutError, setPayoutError] = useState<string | null>(null)

  // Form Rekening Bank
  const [bankCode, setBankCode] = useState('014')
  const [bankAccount, setBankAccount] = useState('')
  const [verifyingBank, setVerifyingBank] = useState(false)
  const [bankSuccess, setBankSuccess] = useState<string | null>(null)
  const [bankError, setBankError] = useState<string | null>(null)

  // Form Pengaturan Jadwal
  const [autoPayoutEnabled, setAutoPayoutEnabled] = useState(false)
  const [payoutFrequency, setPayoutFrequency] = useState('manual')
  const [payoutDay, setPayoutDay] = useState(1)
  const [holdMinBalance, setHoldMinBalance] = useState('0')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSuccess, setSettingsSuccess] = useState(false)

  const loadWallet = async () => {
    try {
      setLoading(true)
      const res = await api.getWallet()
      setData(res)
      if (res.wallet) {
        setBankCode(res.wallet.bankCode || '014')
        setBankAccount(res.wallet.bankAccount || '')
        setAutoPayoutEnabled(res.wallet.autoPayoutEnabled)
        setPayoutFrequency(res.wallet.payoutFrequency || 'manual')
        setPayoutDay(res.wallet.payoutDay || 1)
        setHoldMinBalance(String(res.wallet.holdMinBalance || 0))
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat informasi saldo')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadWallet()
  }, [])

  const handleVerifyBank = async (e: React.FormEvent) => {
    e.preventDefault()
    setVerifyingBank(true)
    setBankError(null)
    setBankSuccess(null)
    try {
      const res = await api.verifyBankAccount({ bankCode, bankAccount })
      setBankSuccess(`Rekening terverifikasi atas nama: ${res.bank.accountName}`)
      await loadWallet()
    } catch (err) {
      setBankError(err instanceof Error ? err.message : 'Gagal memvalidasi rekening via DOKU')
    } finally {
      setVerifyingBank(false)
    }
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSettings(true)
    setSettingsSuccess(false)
    try {
      await api.updateWalletSettings({
        autoPayoutEnabled,
        payoutFrequency,
        payoutDay: Number(payoutDay),
        holdMinBalance: Number(holdMinBalance) || 0,
      })
      setSettingsSuccess(true)
      setTimeout(() => setSettingsSuccess(false), 3000)
      await loadWallet()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan')
    } finally {
      setSavingSettings(false)
    }
  }

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = Number(payoutAmount)
    if (isNaN(amount) || amount <= 0) {
      setPayoutError('Masukkan nominal yang valid')
      return
    }

    setPayoutSubmitting(true)
    setPayoutError(null)
    try {
      await api.requestPayout(amount)
      setShowPayoutModal(false)
      setPayoutAmount('')
      await loadWallet()
      alert('Pengajuan penarikan dana berhasil dikirim! Admin akan segera memproses transfer.')
    } catch (err) {
      setPayoutError(err instanceof Error ? err.message : 'Gagal mengajukan penarikan dana')
    } finally {
      setPayoutSubmitting(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-stone-500">
          <span className="material-symbols-outlined animate-spin text-4xl">progress_activity</span>
          <p>Memuat data saldo dan pencairan...</p>
        </div>
      </div>
    )
  }

  const wallet = data?.wallet
  const available = wallet?.availableBalance ?? 0
  const pending = wallet?.pendingBalance ?? 0
  const holdMin = wallet?.holdMinBalance ?? 0
  const maxWithdrawable = Math.max(0, available - holdMin)

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">Saldo & Pencairan Dana</h1>
          <p className="text-sm text-stone-500">
            Kelola pendapatan dari transaksi QRIS/VA DOKU, jadwal pencairan otomatis, dan penarikan langsung.
          </p>
        </div>
        <button
          onClick={() => {
            setPayoutError(null)
            setPayoutAmount(String(maxWithdrawable > 0 ? maxWithdrawable : ''))
            setShowPayoutModal(true)
          }}
          disabled={!wallet?.isBankVerified || maxWithdrawable < (wallet?.minimumPayout ?? 50000)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          <span className="material-symbols-outlined text-lg">payments</span>
          Tarik Dana Sekarang
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 3 Status Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Card 1: Saldo Siap Ditarik */}
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Saldo Siap Ditarik</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Aktif</span>
          </div>
          <div className="mt-3 text-3xl font-extrabold text-stone-900">
            {formatRupiah(available)}
          </div>
          <div className="mt-2 text-xs text-stone-500">
            {holdMin > 0 ? (
              <span>Dapat ditarik: <b className="text-stone-700">{formatRupiah(maxWithdrawable)}</b> (Cadangan: {formatRupiah(holdMin)})</span>
            ) : (
              <span>Minimal penarikan {formatRupiah(wallet?.minimumPayout ?? 50000)}</span>
            )}
          </div>
        </div>

        {/* Card 2: Saldo Menunggu Settlement H+1 */}
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Menunggu Settlement H+1</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Pending</span>
          </div>
          <div className="mt-3 text-3xl font-extrabold text-amber-600">
            {formatRupiah(pending)}
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Transaksi QRIS/VA hari ini. Otomatis pindah ke saldo aktif setiap tengah malam setelah kliring bank DOKU.
          </p>
        </div>

        {/* Card 3: Rekening Penerima */}
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Rekening Tujuan</span>
            {wallet?.isBankVerified ? (
              <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                <span className="material-symbols-outlined text-xs">verified</span> Terverifikasi DOKU
              </span>
            ) : (
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-600">Belum Ada</span>
            )}
          </div>
          {wallet?.isBankVerified ? (
            <div className="mt-3">
              <div className="font-bold text-stone-900">
                {SUPPORTED_BANKS.find((b) => b.code === wallet.bankCode)?.name || wallet.bankCode}
              </div>
              <div className="font-mono text-sm text-stone-700">{wallet.bankAccount}</div>
              <div className="mt-1 text-xs font-semibold text-emerald-700">a/n {wallet.accountName}</div>
            </div>
          ) : (
            <div className="mt-3 text-sm text-stone-500">
              Silakan daftarkan dan verifikasi rekening bank Anda di bawah agar dapat menerima pencairan dana.
            </div>
          )}
        </div>
      </div>

      {/* Grid: Form Verifikasi Bank & Form Jadwal Auto-Payout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Form Verifikasi Rekening */}
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-stone-100 pb-4">
            <span className="material-symbols-outlined text-amber-600">account_balance</span>
            <h2 className="text-base font-bold text-stone-900">Verifikasi Rekening Bank</h2>
          </div>
          <form onSubmit={handleVerifyBank} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700">Bank Tujuan</label>
              <select
                value={bankCode}
                onChange={(e) => setBankCode(e.target.value)}
                className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 shadow-sm focus:border-amber-500 focus:outline-none"
              >
                {SUPPORTED_BANKS.map((b) => (
                  <option key={b.code} value={b.code}>{b.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700">Nomor Rekening</label>
              <input
                type="text"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Contoh: 8820123456"
                required
                className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 font-mono text-sm text-stone-800 shadow-sm focus:border-amber-500 focus:outline-none"
              />
              <span className="mt-1 block text-xs text-stone-400">
                Sistem akan memvalidasi nama pemilik rekening secara instan via DOKU SNAP BI-FAST.
              </span>
            </div>

            {bankError && (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{bankError}</div>
            )}
            {bankSuccess && (
              <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">{bankSuccess}</div>
            )}

            <button
              type="submit"
              disabled={verifyingBank || !bankAccount}
              className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:bg-stone-300"
            >
              {verifyingBank && <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>}
              {verifyingBank ? 'Memverifikasi ke Bank...' : 'Verifikasi & Simpan Rekening'}
            </button>
          </form>
        </div>

        {/* Form Pengaturan Auto-Payout */}
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-stone-100 pb-4">
            <span className="material-symbols-outlined text-amber-600">schedule</span>
            <h2 className="text-base font-bold text-stone-900">Jadwal Pencairan Otomatis (Auto-Payout)</h2>
          </div>
          <form onSubmit={handleSaveSettings} className="mt-4 space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-stone-50 p-3">
              <div>
                <div className="text-sm font-semibold text-stone-800">Aktifkan Auto-Payout</div>
                <div className="text-xs text-stone-500">Pencairan diajukan otomatis sesuai siklus yang dipilih</div>
              </div>
              <input
                type="checkbox"
                checked={autoPayoutEnabled}
                onChange={(e) => setAutoPayoutEnabled(e.target.checked)}
                className="h-5 w-5 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-stone-700">Frekuensi</label>
                <select
                  value={payoutFrequency}
                  onChange={(e) => setPayoutFrequency(e.target.value)}
                  disabled={!autoPayoutEnabled}
                  className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 shadow-sm focus:border-amber-500 focus:outline-none disabled:bg-stone-100"
                >
                  <option value="manual">Manual Saja</option>
                  <option value="daily">Harian (Tiap Hari)</option>
                  <option value="weekly">Mingguan (Tiap Senin)</option>
                  <option value="monthly">Bulanan (Tgl 25)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700">Cadangan Kas di Akun (Rp)</label>
                <input
                  type="number"
                  value={holdMinBalance}
                  onChange={(e) => setHoldMinBalance(e.target.value)}
                  placeholder="0"
                  className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm text-stone-800 shadow-sm focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            {settingsSuccess && (
              <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
                Pengaturan jadwal pencairan berhasil diperbarui!
              </div>
            )}

            <button
              type="submit"
              disabled={savingSettings}
              className="inline-flex items-center gap-2 rounded-xl bg-stone-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:bg-stone-300"
            >
              {savingSettings ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </button>
          </form>
        </div>
      </div>

      {/* Tabs Riwayat: Payouts & Ledger */}
      <div className="rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="flex border-b border-stone-100 px-6 pt-4">
          <button
            onClick={() => setActiveTab('payouts')}
            className={`border-b-2 pb-3 text-sm font-semibold transition ${
              activeTab === 'payouts'
                ? 'border-amber-600 text-amber-600'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Riwayat Penarikan Dana ({data?.payouts.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`ml-6 border-b-2 pb-3 text-sm font-semibold transition ${
              activeTab === 'transactions'
                ? 'border-amber-600 text-amber-600'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Buku Besar Mutasi Saldo ({data?.transactions.length || 0})
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'payouts' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-stone-700">
                <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-4 py-3">No. Tiket</th>
                    <th className="px-4 py-3">Waktu</th>
                    <th className="px-4 py-3">Nominal</th>
                    <th className="px-4 py-3">Tipe</th>
                    <th className="px-4 py-3">Rekening Tujuan</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Ref. Transfer Bank</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.payouts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-stone-400">
                        Belum ada riwayat penarikan dana.
                      </td>
                    </tr>
                  ) : (
                    data?.payouts.map((p) => (
                      <tr key={p.id} className="hover:bg-stone-50/50">
                        <td className="px-4 py-3 font-mono font-medium text-stone-900">{p.requestNumber}</td>
                        <td className="px-4 py-3 text-xs text-stone-500">
                          {new Date(p.createdAt).toLocaleDateString('id-ID', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-3 font-semibold text-stone-900">{formatRupiah(p.amount)}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="rounded-md bg-stone-100 px-2 py-0.5 text-stone-600">
                            {p.source === 'scheduled' ? 'Jadwal Otomatis' : 'Tarik Manual'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div>{p.bankCode} - {p.bankAccount}</div>
                          <div className="font-semibold text-stone-600">{p.accountName}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {p.status === 'completed' && (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                              Berhasil Ditransfer
                            </span>
                          )}
                          {p.status === 'pending' && (
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
                              Diproses Admin
                            </span>
                          )}
                          {p.status === 'rejected' && (
                            <span className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700" title={p.rejectionReason || ''}>
                              Ditolak (Dana Dikembalikan)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-stone-600">
                          {p.bankRefNumber || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-stone-700">
                <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-4 py-3">Waktu</th>
                    <th className="px-4 py-3">Tipe Mutasi</th>
                    <th className="px-4 py-3">Nominal</th>
                    <th className="px-4 py-3">Saldo Sebelum</th>
                    <th className="px-4 py-3">Saldo Sesudah</th>
                    <th className="px-4 py-3">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-sm text-stone-400">
                        Belum ada mutasi transaksi.
                      </td>
                    </tr>
                  ) : (
                    data?.transactions.map((t) => (
                      <tr key={t.id} className="hover:bg-stone-50/50">
                        <td className="px-4 py-3 text-xs text-stone-500">
                          {new Date(t.createdAt).toLocaleDateString('id-ID', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold">
                          {t.type === 'ORDER_INFLOW' && <span className="text-emerald-600">+ PENDAPATAN ORDER</span>}
                          {t.type === 'PAYOUT_DEDUCTION' && <span className="text-red-600">- PENARIKAN DANA</span>}
                          {t.type === 'SETTLEMENT' && <span className="text-blue-600">SETTLEMENT H+1</span>}
                          {t.type === 'REFUND' && <span className="text-amber-600">+ REFUND PENARIKAN</span>}
                        </td>
                        <td className="px-4 py-3 font-semibold">
                          {t.type === 'PAYOUT_DEDUCTION' ? (
                            <span className="text-red-600">-{formatRupiah(t.amount)}</span>
                          ) : (
                            <span className="text-emerald-700">+{formatRupiah(t.amount)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-stone-500">{formatRupiah(t.balanceBefore)}</td>
                        <td className="px-4 py-3 text-xs font-medium text-stone-900">{formatRupiah(t.balanceAfter)}</td>
                        <td className="px-4 py-3 text-xs text-stone-600">{t.description || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal Dialog Tarik Dana */}
      {showPayoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-lg font-bold text-stone-900">Ajukan Penarikan Dana</h3>
              <button
                onClick={() => setShowPayoutModal(false)}
                className="text-stone-400 hover:text-stone-600"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleRequestPayout} className="mt-4 space-y-4">
              <div className="rounded-xl bg-stone-50 p-3 text-xs text-stone-600">
                <div>Transfer ke: <b className="text-stone-800">{wallet?.bankAccount} ({wallet?.bankCode})</b></div>
                <div>Atas Nama: <b className="text-stone-800">{wallet?.accountName}</b></div>
                <div className="mt-1 text-emerald-700">Maksimal dapat ditarik: <b>{formatRupiah(maxWithdrawable)}</b></div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700">Nominal Penarikan (Rp)</label>
                <input
                  type="number"
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  placeholder="Contoh: 150000"
                  min={wallet?.minimumPayout ?? 50000}
                  max={maxWithdrawable}
                  required
                  className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-base font-bold text-stone-900 shadow-sm focus:border-amber-500 focus:outline-none"
                />
                <span className="mt-1 block text-xs text-stone-400">
                  Minimal penarikan {formatRupiah(wallet?.minimumPayout ?? 50000)}. Dana akan diproses oleh admin platform.
                </span>
              </div>

              {payoutError && (
                <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{payoutError}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPayoutModal(false)}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={payoutSubmitting || Number(payoutAmount) <= 0 || Number(payoutAmount) > maxWithdrawable}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:bg-stone-300"
                >
                  {payoutSubmitting ? 'Mengajukan...' : 'Konfirmasi Penarikan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
