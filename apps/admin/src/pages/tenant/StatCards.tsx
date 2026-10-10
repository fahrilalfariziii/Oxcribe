import { StatCards as SharedStats } from '../../components/StatCards'
import { rp } from './types'
import type { TenantDetail } from './types'

// Empat kartu ringkas tenant. Sumber data sama seperti sebelumnya.
export function StatCards({ usage }: { usage: TenantDetail['usage'] }) {
  return (
    <SharedStats
      columns={4}
      stats={[
        { label: 'Order 30 Hari', value: Number(usage.orders30d).toLocaleString('id-ID'), icon: 'shopping_bag' },
        { label: 'Omzet 30 Hari', value: rp(Number(usage.revenue30d)), icon: 'payments' },
        { label: 'Staff Aktif', value: `${usage.staffCount} akun`, icon: 'group' },
        { label: 'Meja Aktif', value: `${usage.tableCount} meja`, icon: 'table_restaurant' },
      ]}
    />
  )
}
