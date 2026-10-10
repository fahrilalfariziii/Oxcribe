import { useEffect, useState } from 'react'
import { platformApi, type LandingSectionRow } from '../lib/platform-api'
import { Alert, Button, Card, CardTitle, Field, Input, PageHeader, Skeleton, Textarea } from '../components/ui'

type StrMap = Record<string, string>
type ItemList = StrMap[]

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asItems(v: unknown): ItemList {
  if (!Array.isArray(v)) return []
  return v.filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null).map((i) => {
    const o: StrMap = {}
    for (const [k, val] of Object.entries(i)) o[k] = asStr(val)
    return o
  })
}

const SECTION_META: Record<string, { title: string; desc: string }> = {
  hero: { title: 'Hero', desc: 'Badge, judul, dan subjudul bagian atas landing.' },
  features: { title: 'Fitur', desc: 'Heading + kartu keunggulan (tambah/hapus baris).' },
  faq: { title: 'FAQ', desc: 'Heading + daftar tanya jawab (tambah/hapus baris).' },
  cta: { title: 'CTA', desc: 'Kartu ajakan menghubungi sales.' },
  contact: { title: 'Kontak', desc: 'Nomor WhatsApp sales + jam online.' },
  services: { title: 'Jasa Website', desc: 'Badge, heading, kartu layanan, dan tahap alur kerja.' },
  home: { title: 'Home', desc: 'Badge, judul, dua kartu produk, dan strip CTA halaman depan.' },
}

export function ContentPage() {
  const [sections, setSections] = useState<LandingSectionRow[]>([])
  const [forms, setForms] = useState<Record<string, Record<string, unknown>>>({})
  const [published, setPublished] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await platformApi.getContent()
      setSections(res.sections)
      const f: Record<string, Record<string, unknown>> = {}
      const p: Record<string, boolean> = {}
      for (const s of res.sections) {
        f[s.sectionKey] = (s.content ?? {}) as Record<string, unknown>
        p[s.sectionKey] = s.isPublished
      }
      setForms(f)
      setPublished(p)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function set(key: string, field: string, value: unknown) {
    setForms((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), [field]: value } }))
  }

  function setItem(key: string, index: number, field: string, value: string, list = 'items') {
    const items = asItems(forms[key]?.[list])
    items[index] = { ...(items[index] ?? {}), [field]: value }
    set(key, list, items)
  }

  function addItem(key: string, blank: StrMap, list = 'items') {
    set(key, list, [...asItems(forms[key]?.[list]), blank])
  }

  function removeItem(key: string, index: number, list = 'items') {
    set(key, list, asItems(forms[key]?.[list]).filter((_, i) => i !== index))
  }

  async function saveAll() {
    setError('')
    setNotice('')
    // Validasi ringan: judul hero, CTA & home tidak boleh kosong.
    for (const key of ['hero', 'cta', 'home']) {
      if (forms[key] && !asStr(forms[key].title).trim()) {
        setError(`Judul section "${key}" wajib diisi.`)
        return
      }
    }
    setBusy(true)
    try {
      await platformApi.saveContent(
        sections.map((s) => ({
          sectionKey: s.sectionKey,
          content: (forms[s.sectionKey] ?? {}) as Record<string, unknown>,
          isPublished: published[s.sectionKey] ?? true,
        })),
      )
      setNotice('Konten disimpan & publish — landing page langsung berubah.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Konten Landing"
        desc="Edit teks langsung per section — tanpa JSON, tanpa deploy ulang. Harga/fitur paket tetap dari menu Paket."
        actions={
          sections.length > 0 && (
            <Button size="sm" onClick={() => void saveAll()} disabled={busy}>
              {busy ? 'Menyimpan…' : 'Simpan & Publish Semua'}
            </Button>
          )
        }
      />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {loading ? (
        <Skeleton lines={6} />
      ) : sections.length === 0 ? (
        <Card>
          <p className="py-4 text-center text-sm text-slate-400">Belum ada section (jalankan seed backend).</p>
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <nav aria-label="Navigasi section" className="flex flex-wrap gap-1.5">
              {sections.map((s) => (
                <a
                  key={s.sectionKey}
                  href={`#section-${s.sectionKey}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-200 hover:text-slate-900"
                >
                  {SECTION_META[s.sectionKey]?.title ?? s.sectionKey}
                  {!s.isPublished && (
                    <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">draft</span>
                  )}
                </a>
              ))}
            </nav>
          </Card>
          {sections.map((s) => (
            <div key={s.sectionKey} id={`section-${s.sectionKey}`} className="scroll-mt-4">
            <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>{SECTION_META[s.sectionKey]?.title ?? s.sectionKey}</CardTitle>
                {SECTION_META[s.sectionKey]?.desc && (
                  <p className="mt-0.5 text-xs text-slate-500">{SECTION_META[s.sectionKey].desc}</p>
                )}
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={published[s.sectionKey] ?? true}
                  onChange={(e) => setPublished({ ...published, [s.sectionKey]: e.target.checked })}
                />
                Published
              </label>
            </div>
            <div className="mt-4">
              <SectionEditor sectionKey={s.sectionKey} form={forms[s.sectionKey] ?? {}} set={set} setItem={setItem} addItem={addItem} removeItem={removeItem} />
            </div>
          </Card>
          </div>
          ))}
        </>
      )}
    </section>
  )
}

type EditorProps = {
  sectionKey: string
  form: Record<string, unknown>
  set: (key: string, field: string, value: unknown) => void
  setItem: (key: string, index: number, field: string, value: string, list?: string) => void
  addItem: (key: string, blank: StrMap, list?: string) => void
  removeItem: (key: string, index: number, list?: string) => void
}

function SectionEditor({ sectionKey, form, set, setItem, addItem, removeItem }: EditorProps) {
  if (sectionKey === 'hero' || sectionKey === 'cta') {
    return (
      <div className="space-y-3">
        <Field label="Badge">
          <Input value={asStr(form.badge)} onChange={(e) => set(sectionKey, 'badge', e.target.value)} />
        </Field>
        <Field label="Judul">
          <Input value={asStr(form.title)} onChange={(e) => set(sectionKey, 'title', e.target.value)} />
        </Field>
        <Field label="Subjudul">
          <Textarea value={asStr(form.subtitle)} onChange={(e) => set(sectionKey, 'subtitle', e.target.value)} rows={3} />
        </Field>
        {sectionKey === 'cta' && (
          <Field label="Catatan kecil">
            <Input value={asStr(form.note)} onChange={(e) => set(sectionKey, 'note', e.target.value)} />
          </Field>
        )}
      </div>
    )
  }

  if (sectionKey === 'features') {
    return (
      <div className="space-y-3">
        <Field label="Heading">
          <Input value={asStr(form.heading)} onChange={(e) => set(sectionKey, 'heading', e.target.value)} />
        </Field>
        {asItems(form.items).map((item, i) => (
          <div key={i} className="space-y-3 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kartu {i + 1}</p>
              <button onClick={() => removeItem(sectionKey, i)} className="text-xs font-medium text-red-700 hover:underline">
                hapus
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ikon (nama Material Symbol)">
                <Input value={item.icon ?? ''} onChange={(e) => setItem(sectionKey, i, 'icon', e.target.value)} placeholder="qr_code_2" className="font-mono" />
              </Field>
              <Field label="Tag kecil">
                <Input value={item.tag ?? ''} onChange={(e) => setItem(sectionKey, i, 'tag', e.target.value)} />
              </Field>
            </div>
            <Field label="Judul">
              <Input value={item.title ?? ''} onChange={(e) => setItem(sectionKey, i, 'title', e.target.value)} />
            </Field>
            <Field label="Deskripsi">
              <Textarea value={item.desc ?? ''} onChange={(e) => setItem(sectionKey, i, 'desc', e.target.value)} rows={2} />
            </Field>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => addItem(sectionKey, { icon: '', title: '', desc: '', tag: '' })}>
          <span className="material-symbols-outlined text-lg">add</span>
          Tambah kartu
        </Button>
      </div>
    )
  }

  if (sectionKey === 'faq') {
    return (
      <div className="space-y-3">
        <Field label="Heading">
          <Input value={asStr(form.heading)} onChange={(e) => set(sectionKey, 'heading', e.target.value)} />
        </Field>
        <Field label="Subheading">
          <Input value={asStr(form.subtitle)} onChange={(e) => set(sectionKey, 'subtitle', e.target.value)} />
        </Field>
        {asItems(form.items).map((item, i) => (
          <div key={i} className="space-y-3 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">FAQ {i + 1}</p>
              <button onClick={() => removeItem(sectionKey, i)} className="text-xs font-medium text-red-700 hover:underline">
                hapus
              </button>
            </div>
            <Field label="Pertanyaan">
              <Input value={item.q ?? ''} onChange={(e) => setItem(sectionKey, i, 'q', e.target.value)} />
            </Field>
            <Field label="Jawaban">
              <Textarea value={item.a ?? ''} onChange={(e) => setItem(sectionKey, i, 'a', e.target.value)} rows={3} />
            </Field>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => addItem(sectionKey, { q: '', a: '' })}>
          <span className="material-symbols-outlined text-lg">add</span>
          Tambah FAQ
        </Button>
      </div>
    )
  }

  if (sectionKey === 'contact') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="WhatsApp sales (format internasional)">
          <Input value={asStr(form.whatsapp)} onChange={(e) => set(sectionKey, 'whatsapp', e.target.value)} placeholder="6281234567890" className="font-mono" />
        </Field>
        <Field label="Jam online">
          <Input value={asStr(form.hours)} onChange={(e) => set(sectionKey, 'hours', e.target.value)} />
        </Field>
      </div>
    )
  }

  if (sectionKey === 'services') {
    return (
      <div className="space-y-3">
        <Field label="Badge">
          <Input value={asStr(form.badge)} onChange={(e) => set(sectionKey, 'badge', e.target.value)} />
        </Field>
        <Field label="Heading">
          <Input value={asStr(form.heading)} onChange={(e) => set(sectionKey, 'heading', e.target.value)} />
        </Field>
        <Field label="Subheading">
          <Textarea value={asStr(form.subtitle)} onChange={(e) => set(sectionKey, 'subtitle', e.target.value)} rows={2} />
        </Field>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kartu layanan</p>
        {asItems(form.items).map((item, i) => (
          <div key={i} className="space-y-3 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Layanan {i + 1}</p>
              <button onClick={() => removeItem(sectionKey, i)} className="text-xs font-medium text-red-700 hover:underline">
                hapus
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ikon (nama Material Symbol)">
                <Input value={item.icon ?? ''} onChange={(e) => setItem(sectionKey, i, 'icon', e.target.value)} placeholder="business" className="font-mono" />
              </Field>
              <Field label="Tag kecil">
                <Input value={item.tag ?? ''} onChange={(e) => setItem(sectionKey, i, 'tag', e.target.value)} />
              </Field>
            </div>
            <Field label="Judul">
              <Input value={item.title ?? ''} onChange={(e) => setItem(sectionKey, i, 'title', e.target.value)} />
            </Field>
            <Field label="Deskripsi">
              <Textarea value={item.desc ?? ''} onChange={(e) => setItem(sectionKey, i, 'desc', e.target.value)} rows={2} />
            </Field>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => addItem(sectionKey, { icon: '', title: '', desc: '', tag: '' })}>
          <span className="material-symbols-outlined text-lg">add</span>
          Tambah layanan
        </Button>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tahap alur kerja</p>
        {asItems(form.steps).map((step, i) => (
          <div key={i} className="space-y-3 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tahap {i + 1}</p>
              <button
                onClick={() =>
                  set(sectionKey, 'steps', asItems(form.steps).filter((_, j) => j !== i))
                }
                className="text-xs font-medium text-red-700 hover:underline"
              >
                hapus
              </button>
            </div>
            <Field label="Judul tahap">
              <Input
                value={step.title ?? ''}
                onChange={(e) => {
                  const steps = asItems(form.steps)
                  steps[i] = { ...steps[i], title: e.target.value }
                  set(sectionKey, 'steps', steps)
                }}
              />
            </Field>
            <Field label="Deskripsi tahap">
              <Textarea
                value={step.desc ?? ''}
                onChange={(e) => {
                  const steps = asItems(form.steps)
                  steps[i] = { ...steps[i], desc: e.target.value }
                  set(sectionKey, 'steps', steps)
                }}
                rows={2}
              />
            </Field>
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => set(sectionKey, 'steps', [...asItems(form.steps), { title: '', desc: '' }])}
        >
          <span className="material-symbols-outlined text-lg">add</span>
          Tambah tahap
        </Button>
      </div>
    )
  }

  if (sectionKey === 'home') {
    return (
      <HomeEditor
        form={form}
        set={(field, value) => set(sectionKey, field, value)}
        setItem={(index, field, value) => setItem(sectionKey, index, field, value)}
        addItem={(blank) => addItem(sectionKey, blank)}
        removeItem={(index) => removeItem(sectionKey, index)}
        setFaqItem={(index, field, value) => setItem(sectionKey, index, field, value, 'faqs')}
        addFaq={() => addItem(sectionKey, { q: '', a: '' }, 'faqs')}
        removeFaq={(index) => removeItem(sectionKey, index, 'faqs')}
      />
    )
  }

  // Section tak dikenal: tampilkan ringkasan read-only agar tak merusak data.
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
      {JSON.stringify(form, null, 2)}
    </pre>
  )
}

function HomeEditor({ form, set, setItem, addItem, removeItem, setFaqItem, addFaq, removeFaq }: {
  form: Record<string, unknown>
  set: (field: string, value: unknown) => void
  setItem: (index: number, field: string, value: string) => void
  addItem: (blank: StrMap) => void
  removeItem: (index: number) => void
  setFaqItem: (index: number, field: string, value: string) => void
  addFaq: () => void
  removeFaq: (index: number) => void
}) {
  const cta = (form.cta ?? {}) as Record<string, unknown>
  function setCta(field: string, value: string) {
    set('cta', { ...cta, [field]: value })
  }
  return (
    <div className="space-y-3">
      <Field label="Badge">
        <Input value={asStr(form.badge)} onChange={(e) => set('badge', e.target.value)} />
      </Field>
      <Field label="Judul">
        <Input value={asStr(form.title)} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Subjudul">
        <Textarea value={asStr(form.subtitle)} onChange={(e) => set('subtitle', e.target.value)} rows={2} />
      </Field>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kartu produk</p>
      {asItems(form.products).map((item, i) => (
        <div key={i} className="space-y-3 rounded-lg bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Produk {i + 1}</p>
            <button onClick={() => removeItem(i)} className="text-xs font-medium text-red-700 hover:underline">
              hapus
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ikon (nama Material Symbol)">
              <Input value={item.icon ?? ''} onChange={(e) => setItem(i, 'icon', e.target.value)} placeholder="point_of_sale" className="font-mono" />
            </Field>
            <Field label="Judul">
              <Input value={item.title ?? ''} onChange={(e) => setItem(i, 'title', e.target.value)} />
            </Field>
          </div>
          <Field label="Deskripsi">
            <Textarea value={item.desc ?? ''} onChange={(e) => setItem(i, 'desc', e.target.value)} rows={2} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Teks tombol">
              <Input value={item.ctaLabel ?? ''} onChange={(e) => setItem(i, 'ctaLabel', e.target.value)} />
            </Field>
            <Field label="Tujuan (path, mis. /pos-kafe)">
              <Input value={item.href ?? ''} onChange={(e) => setItem(i, 'href', e.target.value)} placeholder="/pos-kafe" className="font-mono" />
            </Field>
          </div>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => addItem({ icon: '', title: '', desc: '', ctaLabel: '', href: '' })}>
        <span className="material-symbols-outlined text-lg">add</span>
        Tambah produk
      </Button>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Strip CTA</p>
      <Field label="Judul CTA">
        <Input value={asStr(cta.title)} onChange={(e) => setCta('title', e.target.value)} />
      </Field>
      <Field label="Subjudul CTA">
        <Textarea value={asStr(cta.subtitle)} onChange={(e) => setCta('subtitle', e.target.value)} rows={2} />
      </Field>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">FAQ Home</p>
      {asItems(form.faqs).map((item, i) => (
        <div key={i} className="space-y-3 rounded-lg bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">FAQ {i + 1}</p>
            <button onClick={() => removeFaq(i)} className="text-xs font-medium text-red-700 hover:underline">
              hapus
            </button>
          </div>
          <Field label="Pertanyaan">
            <Input value={item.q ?? ''} onChange={(e) => setFaqItem(i, 'q', e.target.value)} />
          </Field>
          <Field label="Jawaban">
            <Textarea value={item.a ?? ''} onChange={(e) => setFaqItem(i, 'a', e.target.value)} rows={3} />
          </Field>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={addFaq}>
        <span className="material-symbols-outlined text-lg">add</span>
        Tambah FAQ
      </Button>
    </div>
  )
}
