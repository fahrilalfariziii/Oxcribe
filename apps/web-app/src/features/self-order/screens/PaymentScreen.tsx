import { useEffect, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import type { Order } from '../../../shared/types'
import { normalizeTheme } from '../../../shared/types'
import { formatRupiah } from '../../../shared/lib/format'
import { platformFeeLabel } from '../../../shared/lib/fees'
import { Button } from '../../../shared/components/ui'
import { IconBack } from '../../../shared/components/icons'
import { useCafe } from '../../../mock/store'
import { subscribeStream } from '../../../lib/stream'

type GatewayData = {
  qrContent?: string
  qrUrl?: string
  qrString?: string
  vaNumber?: string
  vaBank?: string
  expiredDate?: string
  expiry_time?: string
  expiryTime?: string
  raw?: { expiry_time?: string; expiredDate?: string }
}

interface Props {
  order: Order & { payments?: Array<{ gatewayData?: GatewayData }> }
  onBack: () => void
  onConfirm: () => void
  /** Terbitkan ulang QR/VA (partnerReferenceNo DOKU baru). Dipakai saat charge pertama gagal. */
  onRetry?: () => Promise<void>
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

export function PaymentScreen({ order, onBack, onConfirm, onRetry }: Props) {
  const { refreshOrderFromBackend, business } = useCafe()
  const theme = normalizeTheme(business.theme)
  const [liveOrder, setLiveOrder] = useState<Order>(order)
  const [copied, setCopied] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [qrZoom, setQrZoom] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [payNotice, setPayNotice] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
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
  useEffect(() => setLiveOrder(order), [order])
  // Poll BE status + socket for settlement
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      try {
        const updated = await refreshOrderFromBackend(liveOrder.clientOrderId)
        if (cancelled) return
        if (updated) {
          setLiveOrder(updated)
          if (updated.paymentStatus === 'paid') {
            onConfirm()
            return
          }
        }
      } catch {}
      timer = window.setTimeout(poll, 5000)
    }
    // Start poll after 3s
    timer = window.setTimeout(poll, 3000)
    // SSE untuk settlement realtime
    let cleanup: (() => void) | undefined
    try {
      const handler = (payload: unknown) => {
        const p = payload as { clientOrderId?: string; paymentStatus?: string }
        if (p?.clientOrderId === liveOrder.clientOrderId && p?.paymentStatus === 'paid') onConfirm()
      }
      cleanup = subscribeStream({
        qrToken: (liveOrder as unknown as { qrToken?: string }).qrToken as string | undefined,
        handlers: { 'order:payment_updated': handler },
      })
    } catch {}
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      if (cleanup) cleanup()
    }
  }, [liveOrder.clientOrderId, refreshOrderFromBackend, onConfirm, liveOrder])

  const methodLabel = liveOrder.paymentMethod === 'qris' ? 'QRIS' : liveOrder.paymentMethod === 'bank_transfer' ? 'Transfer Bank' : 'Tunai'
  const gatewayData = (liveOrder as Props['order']).payments?.[0]?.gatewayData as GatewayData | undefined
  const rawExpiry = gatewayData?.expiredDate || gatewayData?.raw?.expiredDate || gatewayData?.raw?.expiry_time || gatewayData?.expiry_time || gatewayData?.expiryTime
  const fallbackExpiry = (() => {
    if (rawExpiry) return rawExpiry
    // fallback: QRIS 15 menit, VA 24 jam dari createdAt
    try {
      const base = new Date(liveOrder.createdAt).getTime()
      if (isNaN(base)) return undefined
      const add = liveOrder.paymentMethod === 'bank_transfer' ? 24*3600000 : 15*60000
      const d = new Date(base + add)
      return d.toISOString()
    } catch { return undefined }
  })()
  const expiryText = formatExpiryWIB(fallbackExpiry)
  const countdown = useCountdown(fallbackExpiry)
  const qrValue = gatewayData?.qrContent || gatewayData?.qrString
  const hasQr = Boolean(qrValue || gatewayData?.qrUrl)
  async function copyText(text: string | undefined, key: string) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    } catch {}
  }
  const handleCopyVa = async () => {
    await copyText(gatewayData?.vaNumber, 'va')
  }

  return (
    <div className="flex h-full flex-col" style={{ background: theme.pageBg }}>
      <header className="relative flex h-12 items-center justify-center shadow-sm">
        <button onClick={onBack} className="absolute left-5 size-12" aria-label="Kembali"><IconBack /></button>
        <span className="font-display text-xl font-semibold">Pembayaran</span>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-6 pb-32 scrollbar-hide">
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

        {liveOrder.paymentMethod === 'qris' && (
          <div className="rounded-[12px] border border-[#e2e2e2] bg-white px-5 py-6 text-center shadow-sm">
            {hasQr ? (
              <>
                {qrValue ? (
                  <button type="button" onClick={() => setQrZoom(true)} title="Ketuk untuk perbesar" aria-label="Perbesar QRIS">
                    <div ref={qrCanvasRef} className="mx-auto w-fit border border-clay p-2 rounded-lg bg-white">
                      <QRCodeCanvas value={qrValue} size={288} />
                    </div>
                  </button>
                ) : (
                  <button type="button" onClick={() => setQrZoom(true)} title="Ketuk untuk perbesar" aria-label="Perbesar QRIS">
                    <img src={gatewayData?.qrUrl} alt="QRIS" className="mx-auto size-72 max-w-full object-contain border border-clay p-2 rounded-lg bg-white" />
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
              </>
            ) : (
              <div className="mx-auto max-w-[240px]">
                <p className="text-sm font-semibold text-black">QR belum terbit dari DOKU</p>
                <p className="mt-1 text-xs text-soil">Pembayaran tercatat, tapi kode QR gagal dibuat (mis. gangguan gateway). Muat ulang untuk menerbitkan QR baru.</p>
                {retryError && <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{retryError}</p>}
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={retrying || !onRetry}
                  style={{ background: theme.primary }}
                  className="mt-3 inline-block rounded-full px-6 py-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  {retrying ? 'Menerbitkan…' : 'Muat Ulang QR'}
                </button>
              </div>
            )}
            {hasQr && expiryText && <p className="mt-3 text-xs text-soil">Bayar sebelum <span className="font-semibold text-black">{expiryText}</span></p>}
            {hasQr && countdown && <p className="mt-1 text-[11px] font-bold text-sage">{countdown}</p>}
            {hasQr && <p className="mt-3 text-xs text-soil">Scan dengan GoPay, ShopeePay, DANA, OVO, LinkAja atau m-banking yang dukung QRIS. QR berlaku 15 menit.</p>}
          </div>
        )}

        {liveOrder.paymentMethod === 'bank_transfer' && (
          <div className="rounded-[12px] border border-[#e2e2e2] bg-white px-5 py-6 text-center shadow-sm space-y-3">
            {gatewayData?.vaNumber ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wider text-stone">
                  Virtual Account {gatewayData.vaBank ? `— ${gatewayData.vaBank.toUpperCase()}` : ''}
                </p>
                <p className="text-lg font-mono font-bold tracking-wider text-black">{gatewayData.vaNumber}</p>
                <button type="button" onClick={handleCopyVa} className="mx-auto flex items-center gap-1 rounded-full border border-clay bg-cream px-3 py-1 text-xs font-semibold text-black">
                  <span className="material-symbols-outlined text-[16px]">{copied === 'va' ? 'check' : 'content_copy'}</span>
                  <span>{copied === 'va' ? 'Tersalin' : 'Salin VA'}</span>
                </button>
                <p className="text-sm font-semibold text-black">Total: {formatRupiah(liveOrder.total)}</p>
                {expiryText && <p className="text-xs text-soil">Bayar sebelum <span className="font-semibold text-black">{expiryText}</span></p>}
                {countdown && <p className="mt-1 text-[11px] font-bold text-sage">{countdown}</p>}
                <div className="text-left rounded-lg bg-cream p-3 text-xs leading-relaxed text-soil border border-sand">
                  <p className="font-semibold text-black mb-1">Tata cara pembayaran:</p>
                  <p>1. Buka m-banking / ATM {gatewayData.vaBank ? gatewayData.vaBank.toUpperCase() : ''}</p>
                  <p>2. Pilih Transfer → Virtual Account</p>
                  <p>3. Masukkan nomor VA di atas</p>
                  <p>4. Pastikan nominal {formatRupiah(liveOrder.total)} & nama penerima benar</p>
                  <p>5. Konfirmasi & simpan bukti</p>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-soil">Nomor VA belum terbit dari DOKU.</p>
                <p className="text-sm font-semibold text-black">{formatRupiah(liveOrder.total)}</p>
                {retryError && <p className="text-xs font-medium text-[#ba1a1a]">{retryError}</p>}
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={retrying || !onRetry}
                  style={{ background: theme.primary }}
                  className="mx-auto inline-block rounded-full px-6 py-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  {retrying ? 'Menerbitkan…' : 'Muat Ulang VA'}
                </button>
                {expiryText && <p className="text-xs text-soil">Bayar sebelum {expiryText}</p>}
              </>
            )}
          </div>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex flex-col gap-2 border-t border-clay/10 px-5 pb-6 pt-4" style={{ background: theme.pageBg }}>
        {payNotice && (
          <p className="rounded-[12px] border border-[#9a6b2f]/40 bg-[#f5e8c8] px-4 py-3 text-xs font-medium text-black">{payNotice}</p>
        )}
        <Button className="h-12 w-full rounded-[8px]" style={{ background: theme.primary }} onClick={handleCheckStatus}>
          {checking ? 'Mengecek…' : 'Cek Status Pembayaran'}
        </Button>
        <Button variant="outline" className="h-12 w-full rounded-[8px]" onClick={onBack}>Pilih Metode Lain</Button>
      </div>
      {qrZoom && qrValue && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
          onClick={() => setQrZoom(false)}
        >
          <div className="text-center">
            <div className="mx-auto w-fit rounded-xl bg-white p-3">
              <QRCodeCanvas value={qrValue} size={420} />
            </div>
            <p className="mt-3 text-sm font-semibold text-white">Scan QR ini · ketuk untuk tutup</p>
            <p className="mt-1 font-display text-lg font-bold text-white">{formatRupiah(liveOrder.total)}</p>
          </div>
        </div>
      )}
      {qrZoom && !qrValue && gatewayData?.qrUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
          onClick={() => setQrZoom(false)}
        >
          <div className="text-center">
            <img src={gatewayData.qrUrl} alt="QRIS diperbesar" className="mx-auto w-[min(88vw,420px)] rounded-xl bg-white p-3" />
            <p className="mt-3 text-sm font-semibold text-white">Scan QR ini · ketuk untuk tutup</p>
            <p className="mt-1 font-display text-lg font-bold text-white">{formatRupiah(liveOrder.total)}</p>
          </div>
        </div>
      )}
    </div>
  )
}
