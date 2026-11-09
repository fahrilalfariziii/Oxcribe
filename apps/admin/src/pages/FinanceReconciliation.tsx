import { useEffect, useState } from 'react'
import { platformApi, type PaymentReview, type UnsettledPayment, type WalletRow } from '../lib/platform-api'
import { usePlatform } from '../auth/PlatformAuth'

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100'
const buttonClass = 'rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300'
const rupiah = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)

export function FinanceReconciliation() {
  const { admin } = usePlatform()
  const canWrite = admin?.role === 'superadmin'
  const [payments, setPayments] = useState<UnsettledPayment[]>([])
  const [wallets, setWallets] = useState<WalletRow[]>([])
  const [fees, setFees] = useState<Record<number, string>>({})
  const [reference, setReference] = useState('')
  const [walletId, setWalletId] = useState('')
  const [accountName, setAccountName] = useState('')
  const [evidence, setEvidence] = useState('')
  const [review, setReview] = useState<PaymentReview>({ payments: [], notifications: [] })
  const [refund, setRefund] = useState({ paymentId: '', amount: '', reference: '', proofImageUrl: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [unsettled, banks, reviews] = await Promise.all([platformApi.getUnsettledPayments(), platformApi.getWallets(), platformApi.getPaymentReview()])
      setPayments(unsettled.payments)
      setWallets(banks.wallets)
      setReview(reviews)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data rekonsiliasi')
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function submitSettlement(event: React.FormEvent) {
    event.preventDefault()
    if (!canWrite || busy) return
    const selected = payments.filter((p) => Object.hasOwn(fees, p.id))
    if (!reference.trim() || selected.length === 0) { setError('Isi referensi laporan dan pilih transaksi.'); return }
    if (selected.some((p) => fees[p.id].trim() === '' || !Number.isSafeInteger(Number(fees[p.id])) || Number(fees[p.id]) < 0 || Number(fees[p.id]) > Number(p.amount) - Number(p.refundedAmount))) {
      setError('Biaya aktual wajib rupiah utuh, nol atau lebih, dan tidak melebihi nilai pembayaran setelah refund.'); return
    }
    setBusy(true); setError(''); setNotice('')
    try {
      await platformApi.settlePayments({ reference: reference.trim(), payments: selected.map((p) => ({ paymentId: p.id, gatewayFee: Number(fees[p.id]) })) })
      setReference(''); setFees({}); setNotice('Transaksi terpilih berhasil direkonsiliasi dengan biaya aktual.'); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Rekonsiliasi gagal') }
    finally { setBusy(false) }
  }

  async function verifyBank(event: React.FormEvent) {
    event.preventDefault()
    if (!canWrite || busy || !walletId || !accountName.trim() || !evidence.trim()) return
    const selectedWallet = wallets.find((wallet) => wallet.businessId === Number(walletId))
    if (!selectedWallet?.bankCode || !selectedWallet.bankAccount) { setError('Pilih rekening yang diajukan.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await platformApi.verifyWalletBank(Number(walletId), { accountName: accountName.trim(), evidence: evidence.trim(), bankCode: selectedWallet.bankCode, bankAccount: selectedWallet.bankAccount })
      setWalletId(''); setAccountName(''); setEvidence(''); setNotice('Pemeriksaan rekening tercatat.'); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Verifikasi gagal') }
    finally { setBusy(false) }
  }

  async function recordRefund(event: React.FormEvent) {
    event.preventDefault()
    if (!canWrite || busy) return
    if (!Number.isSafeInteger(Number(refund.paymentId)) || Number(refund.paymentId) <= 0 || !Number.isSafeInteger(Number(refund.amount)) || Number(refund.amount) <= 0) { setError('ID pembayaran dan nominal wajib bilangan bulat positif.'); return }
    if (!refund.reference.trim() || !refund.reason.trim() || !/^https?:\/\//.test(refund.proofImageUrl.trim())) { setError('Referensi, alasan, dan URL bukti refund wajib diisi.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await platformApi.recordPaymentRefund(Number(refund.paymentId), { amount: Number(refund.amount), reference: refund.reference.trim(), proofImageUrl: refund.proofImageUrl.trim(), reason: refund.reason.trim() })
      setRefund({ paymentId: '', amount: '', reference: '', proofImageUrl: '', reason: '' }); setNotice('Refund manual tercatat. Tidak ada pengiriman uang otomatis.'); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal mencatat refund') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {!canWrite && <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Akses support: hanya melihat. Rekonsiliasi, pemeriksaan rekening, dan perubahan pencairan dilakukan superadmin.</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-900">Pembayaran Perlu Pemeriksaan ({review.payments.length}) / Notifikasi Bermasalah ({review.notifications.length})</summary>
        {loading ? <p className="mt-3 text-sm">Memuat kasus...</p> : <div className="mt-3 space-y-2 text-sm text-slate-700">
          {review.payments.length === 0 && review.notifications.length === 0 && <p>Tidak ada kasus pada daftar pemeriksaan.</p>}
          {review.payments.map((p) => <p key={p.id} className="break-words rounded-lg bg-amber-50 p-3">ID {p.id} / {p.business.name} / #{p.order.orderNumber}: {p.reviewReason || 'Perlu rekonsiliasi manual'}. Dibayar {rupiah(Number(p.amount))}, refund tercatat {rupiah(Number(p.refundedAmount))}.</p>)}
          {review.notifications.map((n) => <p key={n.id} className="break-words rounded-lg bg-amber-50 p-3">Notifikasi {n.id}, {n.attempts} percobaan: {n.error || 'Perlu pemeriksaan'} ({new Date(n.createdAt).toLocaleString('id-ID')})</p>)}
          <p className="text-xs">Periksa bukti gateway dan laporan settlement. Kasus ini tidak dapat dihapus dengan mengubah status secara bebas.</p>
        </div>}
      </details>
      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-900">Rekonsiliasi Pendapatan QRIS ({payments.length})</summary>
        <p className="mt-2 text-xs text-slate-600">Pilih hanya pembayaran yang tercantum pada laporan settlement merchant. Masukkan biaya gateway aktual per pembayaran. Pending merupakan estimasi; tidak ada pemindahan otomatis berdasarkan waktu.</p>
        {loading ? <p className="mt-3 text-sm">Memuat pembayaran...</p> : payments.length === 0 ? <p className="mt-3 text-sm text-slate-600">Tidak ada pembayaran menunggu rekonsiliasi.</p> : (
          <form onSubmit={submitSettlement} className="mt-4 space-y-3">
            <label className="block text-xs font-semibold text-slate-700">Referensi Laporan Settlement
              <input required value={reference} onChange={(e) => setReference(e.target.value)} disabled={!canWrite || busy} className={inputClass} />
            </label>
            <div className="max-h-80 space-y-2 overflow-auto">
              {payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3 text-xs">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" checked={Object.hasOwn(fees, p.id)} disabled={!canWrite || busy} onChange={(e) => setFees((prev) => { const next = { ...prev }; if (e.target.checked) next[p.id] = ''; else delete next[p.id]; return next })} />
                    <span>{p.business.name} / #{p.order.orderNumber} / ID {p.id}<br />Dibayar {rupiah(Number(p.amount))}; estimasi bersih {rupiah(Number(p.estimatedNet))}</span>
                  </label>
                  {Object.hasOwn(fees, p.id) && <label className="w-40 font-semibold">Biaya Gateway Aktual (Rp)
                    <input type="number" min="0" max={Number(p.amount) - Number(p.refundedAmount)} step="1" required value={fees[p.id]} disabled={!canWrite || busy} onChange={(e) => setFees((prev) => ({ ...prev, [p.id]: e.target.value }))} className={inputClass} />
                  </label>}
                </div>
              ))}
            </div>
            {canWrite && <button disabled={busy || !reference.trim() || Object.keys(fees).length === 0} className={buttonClass}>{busy ? 'Menyimpan...' : 'Rekonsiliasi Transaksi Terpilih'}</button>}
          </form>
        )}
      </details>
      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-900">Pemeriksaan Rekening Merchant</summary>
        {!loading && <ul className="mt-3 space-y-2 text-xs text-slate-700">{wallets.filter((w) => w.bankAccount && !w.isBankVerified).map((w) => <li key={w.businessId}>{w.business.name}: {w.bankCode} / {w.bankAccount} a/n {w.accountName}</li>)}</ul>}
        {loading ? <p className="mt-3 text-sm">Memuat rekening...</p> : wallets.filter((w) => w.bankAccount && !w.isBankVerified).length === 0 ? <p className="mt-3 text-sm text-slate-600">Tidak ada rekening menunggu pemeriksaan.</p> : (
          <form onSubmit={verifyBank} className="mt-4 space-y-3">
            <label className="block text-xs font-semibold text-slate-700">Rekening yang Diajukan
              <select required value={walletId} disabled={!canWrite || busy} onChange={(e) => { setWalletId(e.target.value); setAccountName(wallets.find((w) => w.businessId === Number(e.target.value))?.accountName ?? '') }} className={inputClass}>
                <option value="">Pilih merchant dan rekening</option>
                {wallets.filter((w) => w.bankAccount && !w.isBankVerified).map((w) => <option key={w.businessId} value={w.businessId}>{w.business.name}: {w.bankCode} / {w.bankAccount} / {w.accountName}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">Nama Pemilik Sesuai Pemeriksaan
              <input required value={accountName} disabled={!canWrite || busy} onChange={(e) => setAccountName(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-slate-700">Bukti dan Referensi Pemeriksaan Manual
              <textarea required value={evidence} disabled={!canWrite || busy} onChange={(e) => setEvidence(e.target.value)} className={inputClass} />
            </label>
            {canWrite && <button disabled={busy || !walletId || !accountName.trim() || !evidence.trim()} className={buttonClass}>{busy ? 'Menyimpan...' : 'Catat Rekening Terverifikasi'}</button>}
          </form>
        )}
      </details>
      {canWrite && <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-900">Catat Refund yang Sudah Ditransfer Manual</summary>
        <p className="mt-2 text-xs text-slate-600">Lakukan transfer pengembalian ke pelanggan dan periksa ID pembayaran terlebih dahulu. Form ini mencatat bukti dan membalik ledger; tidak mengirim uang ke pelanggan.</p>
        <form onSubmit={recordRefund} className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-slate-700">ID Pembayaran<input type="number" min="1" step="1" required value={refund.paymentId} disabled={busy} onChange={(e) => setRefund((prev) => ({ ...prev, paymentId: e.target.value }))} className={inputClass} /></label>
          <label className="block text-xs font-semibold text-slate-700">Nominal Refund (Rp)<input type="number" min="1" step="1" required value={refund.amount} disabled={busy} onChange={(e) => setRefund((prev) => ({ ...prev, amount: e.target.value }))} className={inputClass} /></label>
          <label className="block text-xs font-semibold text-slate-700">Referensi Transfer Refund<input required value={refund.reference} disabled={busy} onChange={(e) => setRefund((prev) => ({ ...prev, reference: e.target.value }))} className={inputClass} /></label>
          <label className="block text-xs font-semibold text-slate-700">URL Bukti Transfer Refund<input type="url" required value={refund.proofImageUrl} disabled={busy} onChange={(e) => setRefund((prev) => ({ ...prev, proofImageUrl: e.target.value }))} className={inputClass} /></label>
          <label className="block text-xs font-semibold text-slate-700">Alasan Refund<textarea required value={refund.reason} disabled={busy} onChange={(e) => setRefund((prev) => ({ ...prev, reason: e.target.value }))} className={inputClass} /></label>
          <button disabled={busy} className={buttonClass}>{busy ? 'Menyimpan...' : 'Catat Bukti Refund Manual'}</button>
        </form>
      </details>}
    </div>
  )
}
