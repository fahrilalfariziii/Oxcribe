import { useEffect, useState } from 'react'
import { usePlatform } from '../auth/PlatformAuth'
import { platformApi, type InvoiceRow } from '../lib/platform-api'
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Skeleton, Table, Td } from '../components/ui'
import { StatCards } from '../components/StatCards'

export function InvoicesPage() {
  const { admin } = usePlatform()
  const isSuper = admin?.role === 'superadmin'
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ businessId: '', amount: '', dueDate: '' })
  const [paying, setPaying] = useState<InvoiceRow | null>(null)
  const [payNote, setPayNote] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await platformApi.getInvoices({ status: status || undefined })
      setInvoices(res.invoices)
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

  async function create() {
    setError('')
    try {
      await platformApi.createInvoice({
        businessId: Number(form.businessId),
        amount: Number(form.amount),
        dueDate: form.dueDate || undefined,
      })
      setNotice('Invoice dibuat.')
      setShowForm(false)
      setForm({ businessId: '', amount: '', dueDate: '' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat')
    }
  }

  async function pay() {
    if (!paying) return
    setError('')
    try {
      await platformApi.payInvoice(paying.id, payNote || undefined)
      setNotice(`Invoice ${paying.invoiceNumber} ditandai lunas.`)
      setPaying(null)
      setPayNote('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menandai lunas')
    }
  }

  function downloadCsv() {
    window.open(platformApi.exportInvoicesUrl(), '_blank', 'noopener')
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Invoice"
        desc="Pembayaran ditransfer di luar sistem, ditandai lunas manual."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={downloadCsv}>
              <span className="material-symbols-outlined text-lg">download</span>
              Export CSV
            </Button>
            {isSuper && (
              <Button size="sm" onClick={() => setShowForm(true)}>
                <span className="material-symbols-outlined text-lg">add</span>
                Invoice
              </Button>
            )}
          </>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {!loading && invoices.length > 0 && (
        <StatCards
          columns={3}
          stats={[
            { label: 'Total Invoice', value: invoices.length.toLocaleString('id-ID'), icon: 'receipt_long' },
            {
              label: 'Belum Lunas (Rp)',
              value: `Rp ${invoices.filter((i) => i.status === 'unpaid' || i.status === 'overdue').reduce((s, i) => s + Number(i.amount || 0), 0).toLocaleString('id-ID')}`,
              icon: 'schedule',
            },
            {
              label: 'Sudah Lunas',
              value: invoices.filter((i) => i.status === 'paid').length.toLocaleString('id-ID'),
              icon: 'check_circle',
            },
          ]}
        />
      )}

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void load()
          }}
          className="flex gap-2"
        >
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-auto">
            <option value="">Semua status</option>
            <option value="unpaid">unpaid</option>
            <option value="paid">paid</option>
            <option value="overdue">overdue</option>
            <option value="void">void</option>
          </Select>
          <Button type="submit" size="sm" className="h-10">
            Filter
          </Button>
        </form>
      </Card>

      {loading ? (
        <Skeleton lines={5} />
      ) : (
        <Table
          head={['Invoice', 'Tenant', 'Jumlah', 'Status', 'Jatuh tempo', 'Aksi']}
          empty={invoices.length === 0 ? 'Belum ada invoice.' : undefined}
        >
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50">
              <Td className="font-mono text-xs">{inv.invoiceNumber}</Td>
              <Td>{inv.business.name}</Td>
              <Td className="tabular">Rp {Number(inv.amount).toLocaleString('id-ID')}</Td>
              <Td>
                <Badge status={inv.status} />
              </Td>
              <Td className="text-xs text-slate-500">{inv.dueDate?.slice(0, 10) ?? '—'}</Td>
              <Td>
                {isSuper && inv.status !== 'paid' && (
                  <Button size="sm" variant="secondary" onClick={() => setPaying(inv)}>
                    Tandai lunas
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {!isSuper && <p className="text-xs text-slate-400">Role support: read-only untuk billing.</p>}

      {showForm && isSuper && (
        <Modal title="Buat invoice" desc="Tagihan manual per tenant per periode." onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <Field label="ID Tenant">
              <Input value={form.businessId} onChange={(e) => setForm({ ...form, businessId: e.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Jumlah (Rp)">
              <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Jatuh tempo">
              <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </Field>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => void create()}>
                Buat
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>
                Batal
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {paying && isSuper && (
        <Modal
          title="Tandai lunas"
          desc={`${paying.invoiceNumber} · ${paying.business.name} · Rp ${Number(paying.amount).toLocaleString('id-ID')}`}
          onClose={() => {
            setPaying(null)
            setPayNote('')
          }}
        >
          <Field label="Catatan pembayaran (opsional)">
            <Input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="mis. transfer BCA 12 Sep" />
          </Field>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              variant="success"
              onClick={() => void pay()}
            >
              Konfirmasi lunas
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPaying(null)
                setPayNote('')
              }}
            >
              Batal
            </Button>
          </div>
        </Modal>
      )}
    </section>
  )
}
