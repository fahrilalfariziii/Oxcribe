import type { Order } from '../../../shared/types'

export function PaymentStatusNotice({ order }: { order: Order }) {
  const paid = order.paymentStatus === 'paid'
  const cancelled = order.status === 'batal' || order.paymentStatus === 'canceled'
  const failed = order.paymentStatus === 'failed'
  const label = paid ? 'Pembayaran lunas'
    : cancelled ? 'Pembayaran dibatalkan'
    : failed ? 'Pembayaran gagal'
    : order.paymentMethod === 'cash' ? 'Bayar di kasir' : 'Menunggu pembayaran QRIS'
  return (
    <p role="status" aria-atomic="true" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${paid ? 'bg-emerald-50 text-emerald-900' : failed || cancelled ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-950'}`}>
      <span aria-hidden="true" className="material-symbols-outlined text-[20px]">{paid ? 'check_circle' : failed || cancelled ? 'error' : 'schedule'}</span>
      {label}
    </p>
  )
}
