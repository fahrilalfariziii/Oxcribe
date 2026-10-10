import { Fragment, useEffect, useState } from 'react'
import { platformApi, type AuditRow } from '../lib/platform-api'
import { Alert, Button, Card, Input, PageHeader, Skeleton, Table, Td } from '../components/ui'
import { JsonBlock } from '../components/JsonBlock'
import { formatDateId } from './tenant/types'

export function AuditPage() {
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [businessId, setBusinessId] = useState('')
  const [action, setAction] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await platformApi.getAuditLogs({
        businessId: businessId ? Number(businessId) : undefined,
        action: action || undefined,
      })
      setLogs(res.logs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="space-y-4">
      <PageHeader title="Audit Log" desc="Siapa mengubah apa, kapan — untuk aksi sensitif." />
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void load()
          }}
          className="flex flex-wrap gap-2"
        >
          <Input
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            placeholder="ID tenant (opsional)"
            inputMode="numeric"
            className="h-10 w-44"
          />
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="aksi (mis. plan_changed)"
            className="h-10 w-56"
          />
          <Button type="submit" size="sm" className="h-10">
            Filter
          </Button>
        </form>
      </Card>
      {error && <Alert tone="error">{error}</Alert>}
      {loading ? (
        <Skeleton lines={5} />
      ) : logs.length === 0 ? (
        <Card>
          <p className="py-4 text-center text-sm text-slate-400">Belum ada log.</p>
        </Card>
      ) : (
        <>
          <p className="text-xs text-slate-400 tabular-nums" aria-live="polite">
            {logs.length} aktivitas · terbaru dulu
          </p>
          <Table head={['Aktivitas', 'Aktor', 'Tenant', 'Waktu', '']}>
            {logs.map((l) => (
              <Fragment key={l.id}>
                <tr className="border-t border-slate-100 hover:bg-slate-50">
                  <Td>
                    <span className="font-mono text-xs font-semibold text-slate-800">{l.action}</span>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {l.platformAdmin?.name ?? '?'}
                    <span className="block text-slate-400">{l.platformAdmin?.email ?? ''}</span>
                  </Td>
                  <Td className="text-xs text-slate-500">{l.business?.name ?? '—'}</Td>
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
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <Td colSpan={5}>
                      <JsonBlock label={`#${l.id} before → after`} data={{ before: l.before, after: l.after }} />
                    </Td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        </>
      )}
    </section>
  )
}
