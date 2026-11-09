import { useEffect, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import type { Order } from '../../../shared/types'
import { normalizeTheme } from '../../../shared/types'
import { formatRupiah } from '../../../shared/lib/format'
import { platformFeeLabel } from '../../../shared/lib/fees'
import { Button } from '../../../shared/components/ui'
import { IconBack } from '../../../shared/components/icons'
import { useCafe } from '../../../mock/store'
import { PaymentStatusNotice } from '../components/PaymentStatusNotice'

type GatewayData = {
  qrContent?: string
  qrUrl?: string
  qrString?: string
  expiredDate?: string
  expiry_time?: string
  expiryTime?: string
  raw?: { expiry_time?: string; expiredDate?: string }
  chargeAttemptStatus?: string
  chargeMessage?: string
}

interface Props {
  order: Order & { payments?: Array<{ gatewayData?: GatewayData }> }
  onBack: () => void
  onConfirm: () => void
  /** Muat status percobaan QRIS yang tersimpan di server. */
  onRetry?: () => Promise<void>
  /** Batalkan order ini lalu kembali (ganti metode bayar). Tanpa ini = kembali biasa. */
  onChangeMethod?: () => Promise<void>
}

/** Parse EMV TLV (tag 2 digit + panjang 2 digit + nilai). */
function parseEmvFields(emv: string): { tag: string; value: string }[] {
  const out: { tag: string; value: string }[] = []
  let i = 0
  while (i + 4 <= emv.length) {
    const tag = emv.slice(i, i + 2)
    const len = parseInt(emv.slice(i + 2, i + 4), 10)
    if (!/^\d{2}$/.test(tag) || !Number.isFinite(len)) break
    const value = emv.slice(i + 4, i + 4 + len)
    if (value.length < len) break
    out.push({ tag, value })
    i += 4 + len
  }
  return out
}

/** Ambil NMID dari EMV QRIS dinamis (tag 26, sub-tag berisi IDxxxxxxxx). */
function extractNmid(qrContent: string | undefined): string | null {
  if (!qrContent) return null
  try {
    for (const f of parseEmvFields(qrContent)) {
      if (f.tag !== '26') continue
      for (const sub of parseEmvFields(f.value)) {
        if ((sub.tag === '01' || sub.tag === '02' || sub.tag === '03') && /^ID\d{5,}/.test(sub.value)) {
          return sub.value
        }
      }
    }
  } catch { /* abaikan, NMID opsional */ }
  return null
}

function formatExpiryWIB(expiry?: string): string | null {
  if (!expiry) return null
  try {
    // DOKU ISO8601 ("2026-09-14T12:34:56+07:00" / "...Z") atau legacy Midtrans "YYYY-MM-DD HH:mm:ss"
    const iso = expiry.includes('T') ? expiry : expiry.replace(' ', 'T') + '+07:00'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' WIB'
  } catch { return null }
}
function useCountdown(expiry?: string) {
  const [text, setText] = useState<string>('')
  useEffect(() => {
    if (!expiry) { setText(''); return }
    const iso = expiry.includes('T') ? expiry : expiry.replace(' ', 'T') + '+07:00'
    const target = new Date(iso).getTime()
    if (isNaN(target)) return
    const tick = () => {
      const diff = target - Date.now()
      if (diff <= 0) { setText('Expired'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setText(`${h > 0 ? h + ' jam ' : ''}${m} menit ${s} detik lagi`)
    }
    tick()
    const iv = window.setInterval(tick, 1000)
    return () => window.clearInterval(iv)
  }, [expiry])
  return text
}

export function PaymentScreen({ order: liveOrder, onBack, onConfirm, onRetry, onChangeMethod }: Props) {
  const { refreshOrderFromBackend, business } = useCafe()
  const theme = normalizeTheme(business.theme)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [qrZoom, setQrZoom] = useState(false)
  const qrDialogRef = useRef<HTMLDialogElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [payNotice, setPayNotice] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [changingMethod, setChangingMethod] = useState(false)
  const qrCanvasRef = useRef<HTMLDivElement>(null)

  // Tombol "Cek Status" hanya pindah ke layar status bila pembayaran SUDAH lunas.
  // Kalau belum, tetap di halaman pembayaran + tampilkan pemberitahuan.
  async function handleCheckStatus() {
    if (liveOrder.paymentStatus === 'paid') {
      onConfirm()
      return
    }
    setChecking(true)
    setPayNotice(null)
    try {
      const updated = await refreshOrderFromBackend(liveOrder.clientOrderId)
      if (!updated) {
        setPayNotice('Status belum bisa diperiksa. Periksa koneksi lalu coba lagi.')
        return
      }
      if (updated && updated.paymentStatus === 'paid') {
        onConfirm()
        return
      }
      setPayNotice('Pembayaran belum kami terima. Selesaikan pembayaran di atas dulu, lalu cek lagi.')
    } catch {
      setPayNotice('Gagal mengecek status. Periksa koneksi lalu coba lagi.')
    } finally {
      setChecking(false)
    }
  }

  async function handleDownloadQr() {
    setDownloading(true)
    try {
      // QR DOKU (qrContent) dirender via canvas — unduh langsung dari canvas
      const canvas = qrCanvasRef.current?.querySelector('canvas')
      if (canvas && gatewayData?.qrContent) {
        const a = document.createElement('a')
        a.href = canvas.toDataURL('image/png')
        a.download = `QRIS-${liveOrder.orderNumber}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
        return
      }
      // Legacy qrUrl (Midtrans): fetch lalu unduh
      const url = gatewayData?.qrUrl
      if (!url) return
      const res = await fetch(url)
      if (!res.ok) throw new Error('fetch gagal')
      const blob = await res.blob()
      const obj = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = obj
      a.download = `QRIS-${liveOrder.orderNumber}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(obj), 5000)
    } catch {
      const url = gatewayData?.qrUrl
      if (url) window.open(url, '_blank', 'noopener')
    } finally {
      setDownloading(false)
    }
  }

  async function handleRetry() {
    if (!onRetry || retrying) return
    if (gatewayData?.chargeAttemptStatus === 'unknown' || gatewayData?.chargeAttemptStatus === 'creating') {
      setRetryError(gatewayData.chargeMessage || 'Status QRIS sedang diperiksa. Jangan membuat pembayaran baru; hubungi kasir.')
      return
    }
    setRetrying(true)
    setRetryError(null)
    try {
      await onRetry()
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : 'Gagal menerbitkan ulang pembayaran')
    } finally {
      setRetrying(false)
    }
  }

  // "Pilih Metode Lain": batalkan order ini di server
  // lalu kembali — checkout berikutnya menerbitkan order baru.
  async function handleChangeMethod() {
    if (changingMethod) return
    if (!onChangeMethod) {
      onBack()
      return
    }
    setChangingMethod(true)
    setPayNotice(null)
    try {
      await onChangeMethod()
    } catch (e) {
      setPayNotice(e instanceof Error ? e.message : 'Gagal membatalkan pesanan. Coba lagi.')
      setChangingMethod(false)
    }
  }
  useEffect(() => {
    if (liveOrder.paymentStatus === 'paid') onConfirm()
  }, [liveOrder.paymentStatus, onConfirm])

  const methodLabel = liveOrder.paymentMethod === 'qris' ? 'QRIS' : liveOrder.paymentMethod === 'bank_transfer' ? 'Transfer Bank' : 'Tunai'
  const isCancelled = (liveOrder as Order).status === 'batal' || (liveOrder as Order).paymentStatus === 'canceled'
  const gatewayData = (liveOrder as Props['order']).payments?.[0]?.gatewayData as GatewayData | undefined
  const rawExpiry = gatewayData?.expiredDate || gatewayData?.raw?.expiredDate || gatewayData?.raw?.expiry_time || gatewayData?.expiry_time || gatewayData?.expiryTime
  const fallbackExpiry = (() => {
    if (rawExpiry) return rawExpiry
    // Perkiraan batas waktu tampilan; status server tetap authoritative.
    try {
      const base = new Date(liveOrder.createdAt).getTime()
      if (isNaN(base)) return undefined
      const add = 15*60000
      const d = new Date(base + add)
      return d.toISOString()
    } catch { return undefined }
  })()
  const expiryText = formatExpiryWIB(fallbackExpiry)
  const countdown = useCountdown(fallbackExpiry)
  const qrValue = gatewayData?.qrContent || gatewayData?.qrString
  const nmid = extractNmid(qrValue)
  const hasQr = Boolean(qrValue || gatewayData?.qrUrl)
  const showQrZoom = qrZoom && hasQr && !isCancelled && liveOrder.paymentStatus !== 'failed'
  useEffect(() => {
    const dialog = qrDialogRef.current
    if (!showQrZoom || !dialog) return
    dialog.showModal()
    return () => dialog.close()
  }, [showQrZoom])

  return (
    <div className="flex h-full flex-col" style={{ background: theme.pageBg }}>
      <header className="relative flex h-12 items-center justify-center shadow-sm">
        <button onClick={onBack} className="absolute left-5 size-12" aria-label="Kembali"><IconBack /></button>
        <span className="font-display text-xl font-semibold">Pembayaran</span>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-5 scrollbar-hide">
        <PaymentStatusNotice order={liveOrder} />
        {isCancelled && (
          <div className="mb-4 flex items-start gap-2 rounded-[12px] border border-[#ba1a1a]/40 bg-[#ba1a1a]/10 p-4">
            <span className="material-symbols-outlined text-[20px] text-[#ba1a1a]">cancel</span>
            <div>
              <p className="text-sm font-bold text-[#ba1a1a]">Pesanan dibatalkan oleh kasir</p>
              <p className="mt-0.5 text-xs text-soil">Pembayaran tidak perlu dilanjutkan. Silakan buat pesanan baru.</p>
            </div>
          </div>
        )}
        <div className="mb-6 rounded-[12px] border border-[#e2e2e2] bg-white p-[17px] text-center shadow-sm">
          <p className="text-sm font-semibold text-soil">Total Pembayaran</p>
          <p className="font-display text-2xl font-bold">{formatRupiah(liveOrder.total)}</p>
          {(liveOrder.platformFee > 0 || liveOrder.subtotal > 0) && (
            <div className="mt-2 space-y-0.5 text-left text-xs text-soil">
              <div className="flex justify-between"><span>Subtotal</span><span className="text-ink">{formatRupiah(liveOrder.subtotal)}</span></div>
              {liveOrder.platformFee > 0 && liveOrder.platformFeeBearer !== 'cafe' && (
                <div className="flex justify-between"><span>{platformFeeLabel(business, formatRupiah)}</span><span className="text-ink">{formatRupiah(liveOrder.platformFee)}</span></div>
              )}
            </div>
          )}
          <div className="my-4 border-t border-dashed border-[#e2e2e2]" />
          <div className="flex justify-between text-soil text-sm"><span>Order ID</span><span className="font-semibold text-ink">#{liveOrder.orderNumber}</span></div>
          <div className="flex justify-between text-soil text-sm mt-1"><span>Metode</span><span className="font-semibold text-ink">{methodLabel}</span></div>
        </div>

        {liveOrder.paymentMethod === 'cash' && (
          <p className="rounded-[12px] p-4 text-sm text-ink" style={{ background: `${theme.accent}33` }}>Silakan bayar di kasir.</p>
        )}

        {liveOrder.paymentMethod === 'qris' && !isCancelled && liveOrder.paymentStatus !== 'failed' && (
          <div className="overflow-hidden rounded-[12px] border border-[#e2e2e2] bg-white text-center shadow-sm">
            {/* Header standar QRIS */}
            <div className="px-5 pb-3 pt-4" style={{ background: '#C4161C' }}>
              <p className="text-2xl font-black italic tracking-tight text-white">QRIS</p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-white/90">QR Code Standar Pembayaran Nasional</p>
            </div>
            <div className="px-5 py-5">
            <p className="text-sm font-bold text-black">{business.name || 'Merchant'}</p>
            <p className="font-display text-xl font-bold text-black">{formatRupiah(liveOrder.total)}</p>
            {nmid && <p className="mt-1 font-mono text-[11px] text-soil">NMID: {nmid}</p>}
            {hasQr ? (
              <div className="mt-3">
                {qrValue ? (
                  <button type="button" onClick={() => setQrZoom(true)} title="Ketuk untuk perbesar" aria-label="Perbesar QRIS">
                    <div ref={qrCanvasRef} className="mx-auto w-fit border-2 border-clay p-2 rounded-lg bg-white">
                      <QRCodeCanvas value={qrValue} size={240} className="max-w-full !h-auto" />
                    </div>
                  </button>
                ) : (
                  <button type="button" onClick={() => setQrZoom(true)} title="Ketuk untuk perbesar" aria-label="Perbesar QRIS">
                    <img src={gatewayData?.qrUrl} alt="QRIS" className="mx-auto size-64 max-w-full object-contain border-2 border-clay p-2 rounded-lg bg-white" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDownloadQr}
                  disabled={downloading}
                  className="mx-auto mt-3 flex items-center gap-1.5 rounded-full border border-clay bg-cream px-4 py-2 text-xs font-semibold text-black disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  <span>{downloading ? 'Mengunduh…' : 'Download QR'}</span>
                </button>
              </div>
            ) : (
              <div className="mx-auto mt-3 max-w-[240px]">
                {(retrying || gatewayData?.chargeAttemptStatus === 'creating') && <div aria-hidden="true" className="self-order-skeleton mx-auto mb-3 aspect-square w-28 rounded-xl bg-clay/40" />}
                <p role="status" className="text-sm font-semibold text-black">{gatewayData?.chargeAttemptStatus === 'creating' ? 'Menyiapkan QRIS…' : 'QR belum terbit dari DOKU'}</p>
                <p className="mt-1 text-xs text-soil">{gatewayData?.chargeMessage || 'Pesanan tersimpan. Muat status pembayaran untuk memeriksa QR yang diterbitkan server.'}</p>
                {retryError && <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{retryError}</p>}
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={retrying || !onRetry || gatewayData?.chargeAttemptStatus === 'unknown' || gatewayData?.chargeAttemptStatus === 'creating'}
                  style={{ background: theme.primary }}
                  className="mt-3 inline-block rounded-full px-6 py-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  {retrying ? 'Memeriksa...' : 'Muat Status QR'}
                </button>
              </div>
            )}
            {hasQr && expiryText && <p className="mt-3 text-xs text-soil">Bayar sebelum <span className="font-semibold text-black">{expiryText}</span></p>}
            {hasQr && countdown && <p className="mt-1 text-[11px] font-bold text-sage">{countdown}</p>}
            {hasQr && <p className="mt-3 text-xs text-soil">Scan dengan GoPay, ShopeePay, DANA, OVO, LinkAja atau m-banking yang dukung QRIS. QR berlaku 15 menit.</p>}
            <p className="mt-3 border-t border-dashed border-[#e2e2e2] pt-2 text-[10px] text-stone">QRIS dinamis · diterbitkan DOKU · #{liveOrder.orderNumber}</p>
            </div>
          </div>
        )}

        {liveOrder.paymentMethod === 'bank_transfer' && (
          <p className="rounded-lg border border-clay bg-white p-4 text-sm text-soil">Metode pembayaran pesanan lama ini tidak lagi tersedia. Hubungi kasir untuk memeriksa statusnya.</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-clay/20 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" style={{ background: theme.pageBg }}>
        {payNotice && (
          <p role="status" className="rounded-[12px] border border-[#9a6b2f]/40 bg-[#f5e8c8] px-4 py-3 text-xs font-medium text-black">{payNotice}</p>
        )}
        {isCancelled ? (
          <Button className="h-12 w-full rounded-[8px]" style={{ background: theme.primary }} onClick={onBack}>
            Buat Pesanan Baru
          </Button>
        ) : (
          <>
            <Button className="h-12 w-full rounded-[8px]" style={{ background: theme.primary }} onClick={handleCheckStatus} disabled={checking || changingMethod}>
              {checking ? 'Mengecek…' : 'Cek Status Pembayaran'}
            </Button>
            <Button variant="outline" className="h-12 w-full rounded-[8px]" onClick={handleChangeMethod} disabled={changingMethod}>
              {changingMethod ? 'Membatalkan…' : 'Pilih Metode Lain'}
            </Button>
          </>
        )}
      </div>
      {showQrZoom && (
        <dialog ref={qrDialogRef} aria-labelledby="self-order-qr-title"
          className="self-order-sheet fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-[420px] overflow-y-auto rounded-xl bg-white p-4 text-center backdrop:bg-black/75"
          onCancel={(event) => { event.preventDefault(); setQrZoom(false) }}
        >
          <h2 id="self-order-qr-title" className="text-lg font-bold text-ink">Scan QRIS</h2>
          <p className="mb-3 text-sm text-soil">{business.name} · {formatRupiah(liveOrder.total)}</p>
          {qrValue ? <QRCodeCanvas value={qrValue} size={400} className="mx-auto max-w-full !h-auto" />
            : <img src={gatewayData?.qrUrl} alt="QRIS diperbesar" className="mx-auto h-auto max-w-full" />}
          <button type="button" onClick={() => setQrZoom(false)} className="mt-4 min-h-11 w-full rounded-lg border border-clay px-4 font-semibold text-ink">Tutup QRIS</button>
        </dialog>
      )}
    </div>
  )
}
