import { Link } from 'react-router-dom'
import { Card, CardTitle } from '../../components/ui'

export function PaymentTab() {
  return (
    <Card>
      <CardTitle>Pembayaran Self-Order</CardTitle>
      <dl className="mt-4 space-y-4 text-sm text-slate-700">
        <div><dt className="font-semibold text-slate-900">Tunai</dt><dd>Pelanggan membayar di kasir. Pencatatan tunai dan transfer manual POS tidak menambah saldo platform.</dd></div>
        <div><dt className="font-semibold text-slate-900">QRIS dinamis</dt><dd>Penerimaan melalui akun merchant DOKU pusat. Pendapatan masuk sebagai estimasi pending sampai transaksi direkonsiliasi dengan laporan settlement dan biaya aktual.</dd></div>
        <div><dt className="font-semibold text-slate-900">Pencairan manual</dt><dd>Owner mengajukan rekening untuk diperiksa admin. Permohonan pencairan menahan saldo tersedia dan diselesaikan dengan referensi bank serta bukti transfer.</dd></div>
      </dl>
      <Link to="/platform/payouts" className="mt-4 inline-block rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Buka Rekonsiliasi & Pencairan</Link>
    </Card>
  )
}
