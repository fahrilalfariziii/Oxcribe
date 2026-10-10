import { Fragment, useState } from 'react'
import { Card, Input, Table, Td } from '../../components/ui'
import { JsonBlock } from '../../components/JsonBlock'
import { formatDateId } from './types'
import type { TenantDetail } from './types'

// Audit Log: tabel rapi + pencarian client-side + expand before/after.
export function AuditTab({ logs }: { logs: TenantDetail['auditLogs'] }) {
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const needle = q.trim().toLowerCase()
  const rows = needle
    ? logs.filter((l) =>
        [l.action, l.platformAdmin?.name ?? '', l.platformAdmin?.email ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : logs
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400" aria-hidden>
              search
            </span>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari aksi atau aktor…"
              aria-label="Cari audit log"
              className="h-10 pl-10"
            />
          </div>
          <p className="text-xs text-slate-400 tabular-nums">
            {rows.length} dari {logs.length} aktivitas · terbaru dulu
          </p>
        </div>
      </Card>
      <Table head={['Aktivitas', 'Aktor', 'Waktu', '']}>
        {rows.map((l) => (
          <Fragment key={l.id}>
            <tr key={l.id} className="border-t border-slate-100">
              <Td>
                <span className="font-mono text-xs font-semibold text-slate-800">{l.action}</span>
              </Td>
              <Td className="text-xs text-slate-500">
                {l.platformAdmin?.name ?? '?'}
                <span className="block text-slate-400">{l.platformAdmin?.email ?? ''}</span>
              </Td>
              <Td className="whitespace-nowrap text-xs text-slate-500">{formatDateId(l.createdAt)}</Td>
              <Td className="text-right">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                  aria-expanded={expanded === l.id}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  {expanded === l.id ? 'Tutup' : 'Detail'}
                </button>
              </Td>
            </tr>
            {expanded === l.id && (
              <tr key={`${l.id}-detail`} className="border-t border-slate-100 bg-slate-50/60">
                <Td colSpan={4}>
                  <JsonBlock label={`#${l.id} before → after`} data={{ before: l.before, after: l.after }} />
                </Td>
              </tr>
            )}
          </Fragment>
        ))}
      </Table>
      {rows.length === 0 && (
        <p className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-400 ring-1 ring-slate-200">
          {logs.length === 0 ? 'Belum ada riwayat.' : 'Tidak ada yang cocok dengan pencarian.'}
        </p>
      )}
    </div>
  )
}
