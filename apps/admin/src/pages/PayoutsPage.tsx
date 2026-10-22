import { useEffect, useState } from 'react'
import { platformApi } from '../lib/platform-api'
import type { PayoutRow } from '../lib/platform-api'

function formatRupiah(num: number | string): string {
  const n = typeof num === 'string' ? parseFloat(num) : num
  if (isNaN(n)) return 'Rp 0'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n)
}

export function PayoutsPage() {
  const [payouts, setPayouts] = useState<PayoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('pending')

  // Modal Selesaikan Transfer
  const [selectedPayout, setSelectedPayout] = useState<PayoutRow | null>(null)
  const [bankRefNumber, setBankRefNumber] = useState('')
  const [proofImageUrl, setProofImageUrl] = useState('')
  const [submittingComplete, setSubmittingComplete] = useState(false)

  // Modal Tolak Transfer
  const [rejectingPayout, setRejectingPayout] = useState<PayoutRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [submittingReject, setSubmittingReject] = useState(false)

  // Trigger Settlement
  const [triggeringSettlement, setTriggeringSettlement] = useState(false)

  const loadPayouts = async () => {
    try {
      setLoading(true)
      const res = await platformApi.getPayouts(statusFilter ? { status: statusFilter } : undefined)
      setPayouts(res.payouts)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat antrean pencairan dana')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPayouts()
  }, [statusFilter])

  const handleCompletePayout = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPayout || !bankRefNumber.trim()) return

    setSubmittingComplete(true)
    try {
      await platformApi.completePayout(selectedPayout.id, {
        bankRefNumber: bankRefNumber.trim(),
        proofImageUrl: proofImageUrl.trim() || undefined,
      })
      setSelectedPayout(null)
      setBankRefNumber('')
      setProofImageUrl('')
      await loadPayouts()
      alert('Pencairan dana berhasil diselesaikan!')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal menyelesaikan pencairan')
    } finally {
      setSubmittingComplete(false)
    }
  }

  const handleRejectPayout = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rejectingPayout || !rejectReason.trim()) return

    setSubmittingReject(true)
    try {
      await platformApi.rejectPayout(rejectingPayout.id, rejectReason.trim())
      setRejectingPayout(null)
      setRejectReason('')
      await loadPayouts()
      alert('Pencairan dana telah ditolak dan saldo telah dikembalikan ke dompet merchant!')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal menolak pencairan')
    } finally {
      setSubmittingReject(false)
    }
  }

  const handleTriggerSettlement = async () => {
    if (!confirm('Jalankan proses kliring/settlement H+1 sekarang untuk seluruh merchant?')) return
    setTriggeringSettlement(true)
    try {
      const res = await platformApi.triggerSettlement()
      alert(`Settlement berhasil! Memproses ${res.count} dompet merchant.`)
      await loadPayouts()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal menjalankan settlement')
    } finally {
      setTriggeringSettlement(false)
    }
  }

  const pendingCount = payouts.filter((p) => p.status === 'pending').length

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Manajemen Pencairan Dana</h1>
          <p className="text-xs text-slate-500">
            Daftar permohonan penarikan dana merchant. Eksekusi transfer bank via m-Banking lalu konfirmasi di sini.
          </p>
        </div>
        <button
          onClick={handleTriggerSettlement}
          disabled={triggeringSettlement}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-sm">published_with_changes</span>
          {triggeringSettlement ? 'Menjalankan...' : 'Jalankan Settlement H+1'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setStatusFilter('pending')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            statusFilter === 'pending'
              ? 'bg-amber-500 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Perlu Ditransfer ({statusFilter === 'pending' ? payouts.length : pendingCount})
        </button>
        <button
          onClick={() => setStatusFilter('completed')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            statusFilter === 'completed'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Selesai Ditransfer
        </button>
        <button
          onClick={() => setStatusFilter('rejected')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            statusFilter === 'rejected'
              ? 'bg-red-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Ditolak
        </button>
        <button
          onClick={() => setStatusFilter('')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            statusFilter === ''
              ? 'bg-slate-800 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Semua Riwayat
        </button>
      </div>

      {/* Tabel Payout */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">No. Tiket</th>
                <th className="px-4 py-3">Kafe / Merchant</th>
                <th className="px-4 py-3">Nominal Transfer</th>
                <th className="px-4 py-3">Rekening Bank Tujuan (Terverifikasi DOKU)</th>
                <th className="px-4 py-3">Tipe</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tanggal</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    Memuat daftar penarikan dana...
                  </td>
                </tr>
              ) : payouts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    Tidak ada data pencairan dana pada filter ini.
                  </td>
                </tr>
              ) : (
                payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">{p.requestNumber}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <div>{p.business?.name}</div>
                      <div className="text-[10px] text-slate-400">ID: #{p.business?.id}</div>
                    </td>
                    <td className="px-4 py-3 font-extrabold text-slate-900">{formatRupiah(p.amount)}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">
                        {p.bankCode} - <span className="font-mono">{p.bankAccount}</span>
                      </div>
                      <div className="text-[11px] font-semibold text-emerald-700">
                        a/n {p.accountName}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {p.source === 'scheduled' ? 'Jadwal Otomatis' : 'Tarik Manual'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.status === 'pending' && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-bold text-amber-800">
                          Menunggu Transfer
                        </span>
                      )}
                      {p.status === 'completed' && (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-800">
                          Selesai
                        </span>
                      )}
                      {p.status === 'rejected' && (
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 font-bold text-red-800">
                          Ditolak
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500">
                      {new Date(p.createdAt).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.status === 'pending' ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedPayout(p)
                              setBankRefNumber('')
                              setProofImageUrl('')
                            }}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
                          >
                            <span className="material-symbols-outlined text-xs">done</span>
                            Transfer Selesai
                          </button>
                          <button
                            onClick={() => {
                              setRejectingPayout(p)
                              setRejectReason('')
                            }}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                          >
                            Tolak
                          </button>
                        </div>
                      ) : p.status === 'completed' ? (
                        <span className="font-mono text-[11px] text-slate-500">
                          Ref: {p.bankRefNumber || '-'}
                        </span>
                      ) : (
                        <span className="text-[11px] text-red-600" title={p.rejectionReason || ''}>
                          {p.rejectionReason || 'Ditolak'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Selesaikan Transfer */}
      {selectedPayout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Konfirmasi Transfer m-Banking Selesai</h3>
            <p className="mt-1 text-xs text-slate-500">
              Pastikan Anda telah mentransfer dana ke rekening merchant sesuai rincian berikut:
            </p>

            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
              <div>Merchant: <b className="text-slate-900">{selectedPayout.business?.name}</b></div>
              <div>Nominal Transfer: <b className="text-emerald-700 text-sm">{formatRupiah(selectedPayout.amount)}</b></div>
              <div>Bank Tujuan: <b>{selectedPayout.bankCode}</b></div>
              <div>No. Rekening: <b className="font-mono">{selectedPayout.bankAccount}</b></div>
              <div>Atas Nama: <b className="text-slate-900">{selectedPayout.accountName}</b></div>
            </div>

            <form onSubmit={handleCompletePayout} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Nomor Referensi Bank / ID Transaksi *</label>
                <input
                  type="text"
                  value={bankRefNumber}
                  onChange={(e) => setBankRefNumber(e.target.value)}
                  placeholder="Contoh: BCA-20261018-091244"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 shadow-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">URL Bukti Transfer (Opsional)</label>
                <input
                  type="text"
                  value={proofImageUrl}
                  onChange={(e) => setProofImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 shadow-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedPayout(null)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingComplete || !bankRefNumber.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:bg-slate-300"
                >
                  {submittingComplete ? 'Menyimpan...' : 'Tandai Berhasil Ditransfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tolak Transfer */}
      {rejectingPayout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-red-600">Tolak Permohonan Penarikan Dana</h3>
            <p className="mt-1 text-xs text-slate-500">
              Saldo sebesar <b>{formatRupiah(rejectingPayout.amount)}</b> akan otomatis dikembalikan ke dompet merchant <b>{rejectingPayout.business?.name}</b>.
            </p>

            <form onSubmit={handleRejectPayout} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Alasan Penolakan *</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Misal: Nomor rekening tidak aktif atau atas nama tidak sesuai."
                  required
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 shadow-xs focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectingPayout(null)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingReject || !rejectReason.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-red-700 disabled:bg-slate-300"
                >
                  {submittingReject ? 'Menolak...' : 'Konfirmasi Tolak & Refund Saldo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
