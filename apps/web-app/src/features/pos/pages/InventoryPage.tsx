import { useEffect, useState } from 'react'
import { useCafe } from '../../../mock/store'
import { uid } from '../../../shared/lib/format'
import type { Ingredient } from '../../../shared/types'
import { ADJUSTMENT_REASONS } from '../../../shared/types'
import { Button, Field, TextInput } from '../../../shared/components/ui'
import { subscribeStream } from '../../../lib/stream'

type InventoryTab = 'receive' | 'adjust'

export function InventoryPage() {
  const {
    ingredients, movements, upsertIngredient, removeIngredient, recordStock,
    refreshIngredientsFromBackend, refreshMovementsFromBackend,
  } = useCafe()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)

  // BE-first: muat bahan + riwayat asli agar ID sesuai DB, lalu ikuti socket
  // agar catatan dari perangkat lain langsung masuk.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    refreshIngredientsFromBackend()
      .then(() => refreshMovementsFromBackend().catch(() => {}))
      .catch(() => {
        if (!cancelled) setLoadError('Backend tidak terjangkau — menampilkan data lokal.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    let cleanup: (() => void) | undefined
    try {
      const token = localStorage.getItem('servopay_token') || undefined
      const handler = () => {
        refreshIngredientsFromBackend().catch(() => {})
        refreshMovementsFromBackend().catch(() => {})
      }
      cleanup = subscribeStream({ token, handlers: { 'ingredient:stock_updated': handler } })
    } catch {}
    return () => {
      cancelled = true
      if (cleanup) cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function showToast(msg: string, kind: 'success' | 'error') {
    setToast({ msg, kind })
    window.setTimeout(() => setToast(null), kind === 'error' ? 4000 : 2500)
  }

  // State Search Filter
  const [searchQuery, setSearchQuery] = useState('')

  // State Modal Form Bahan (Tambah & Edit)
  const [isIngredientModalOpen, setIsIngredientModalOpen] = useState(false)
  const [editingIngredientId, setEditingIngredientId] = useState<string | null>(null)
  const [ingredientForm, setIngredientForm] = useState({
    name: '',
    unit: 'kg',
    currentStock: '0',
    minimumStock: '0',
  })

  // Tab: Penerimaan supplier vs Penyesuaian & riwayat (alur kerja berbeda)
  const [invTab, setInvTab] = useState<InventoryTab>('receive')

  // State Modal Terima Bahan (Receive — selalu menambah stok)
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false)
  const [receiveForm, setReceiveForm] = useState({
    ingredientId: '',
    supplier: '',
    referenceNo: '',
    quantity: '1',
    unitCost: '',
    batchNo: '',
    expiryDate: '',
    notes: '',
  })

  // State Modal Penyesuaian (Adjustment — bisa + atau −, wajib reason)
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false)
  const [adjustForm, setAdjustForm] = useState({
    ingredientId: '',
    direction: '-' as '+' | '-',
    quantity: '1',
    reason: '',
    notes: '',
  })

  // State Modal Konfirmasi Hapus
  const [deletingIngredient, setDeletingIngredient] = useState<Ingredient | null>(null)

  // State async jujur: modal TIDAK ditutup saat gagal agar input tidak hilang
  const [savingIngredient, setSavingIngredient] = useState(false)
  const [ingredientError, setIngredientError] = useState<string | null>(null)
  const [savingReceive, setSavingReceive] = useState(false)
  const [receiveError, setReceiveError] = useState<string | null>(null)
  const [savingAdjust, setSavingAdjust] = useState(false)
  const [adjustError, setAdjustError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Filter Bahan berdasarkan Search Query
  const filteredIngredients = ingredients.filter((i) =>
    i.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Buka Modal Tambah Bahan Baru
  function handleOpenAddModal() {
    setEditingIngredientId(null)
    setIngredientForm({ name: '', unit: 'kg', currentStock: '0', minimumStock: '0' })
    setIsIngredientModalOpen(true)
  }

  // Buka Modal Edit Bahan
  function handleOpenEditModal(item: Ingredient) {
    setEditingIngredientId(item.id)
    setIngredientForm({
      name: item.name,
      unit: item.unit,
      currentStock: String(item.currentStock),
      minimumStock: String(item.minimumStock),
    })
    setIsIngredientModalOpen(true)
  }

  // Simpan/Update Bahan (BE dulu, baru tutup modal saat sukses)
  async function saveIngredient() {
    if (!ingredientForm.name.trim()) return
    setSavingIngredient(true)
    setIngredientError(null)
    try {
      if (editingIngredientId) {
        const existing = ingredients.find((i) => i.id === editingIngredientId)
        const item: Ingredient = {
          id: editingIngredientId,
          name: ingredientForm.name.trim(),
          unit: ingredientForm.unit,
          currentStock: existing?.currentStock ?? Number(ingredientForm.currentStock),
          minimumStock: Number(ingredientForm.minimumStock),
          isAvailable: existing?.isAvailable ?? Number(ingredientForm.currentStock) > 0,
        }
        await upsertIngredient(item)
      } else {
        await upsertIngredient({
          id: uid('ing'),
          name: ingredientForm.name.trim(),
          unit: ingredientForm.unit,
          currentStock: Number(ingredientForm.currentStock),
          minimumStock: Number(ingredientForm.minimumStock),
          isAvailable: Number(ingredientForm.currentStock) > 0,
        })
      }
      setIsIngredientModalOpen(false)
      showToast('Bahan tersimpan di server!', 'success')
    } catch (e) {
      setIngredientError(e instanceof Error ? e.message : 'Gagal menyimpan bahan')
    } finally {
      setSavingIngredient(false)
    }
  }

  // Terima Bahan: selalu type "in" (qty > 0) + data procurement
  async function handleReceiveStock() {
    const qty = Number(receiveForm.quantity)
    if (!receiveForm.ingredientId) {
      setReceiveError('Pilih bahan dulu.')
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setReceiveError('Jumlah diterima harus lebih dari 0.')
      return
    }
    setSavingReceive(true)
    setReceiveError(null)
    try {
      await recordStock(
        receiveForm.ingredientId,
        'in',
        qty,
        receiveForm.notes || `Terima dari ${receiveForm.supplier || 'supplier'}`,
        {
          supplier: receiveForm.supplier || undefined,
          referenceNo: receiveForm.referenceNo || undefined,
          unitCost: receiveForm.unitCost ? Number(receiveForm.unitCost) : undefined,
          batchNo: receiveForm.batchNo || undefined,
          expiryDate: receiveForm.expiryDate || undefined,
        },
      )
      setIsReceiveModalOpen(false)
      setReceiveForm({ ingredientId: '', supplier: '', referenceNo: '', quantity: '1', unitCost: '', batchNo: '', expiryDate: '', notes: '' })
      showToast('Penerimaan tercatat — stok bertambah!', 'success')
    } catch (e) {
      setReceiveError(e instanceof Error ? e.message : 'Gagal mencatat penerimaan')
    } finally {
      setSavingReceive(false)
    }
  }

  // Penyesuaian: type "adjustment", qty bertanda sesuai arah, reason wajib
  async function handleAdjustStock() {
    const qty = Number(adjustForm.quantity)
    if (!adjustForm.ingredientId) {
      setAdjustError('Pilih bahan dulu.')
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setAdjustError('Jumlah harus lebih dari 0 (arah +/− dipilih terpisah).')
      return
    }
    if (!adjustForm.reason) {
      setAdjustError('Pilih alasan penyesuaian (wajib untuk audit).')
      return
    }
    setSavingAdjust(true)
    setAdjustError(null)
    try {
      const signed = adjustForm.direction === '-' ? -Math.abs(qty) : Math.abs(qty)
      const reasonLabel = ADJUSTMENT_REASONS.find((r) => r.id === adjustForm.reason)?.label ?? adjustForm.reason
      await recordStock(
        adjustForm.ingredientId,
        'adjustment',
        signed,
        adjustForm.notes || reasonLabel,
        { reason: adjustForm.reason },
      )
      setIsAdjustModalOpen(false)
      setAdjustForm({ ingredientId: '', direction: '-', quantity: '1', reason: '', notes: '' })
      showToast('Penyesuaian tercatat di server!', 'success')
    } catch (e) {
      setAdjustError(e instanceof Error ? e.message : 'Gagal mencatat penyesuaian')
    } finally {
      setSavingAdjust(false)
    }
  }

  async function handleDeleteIngredient() {
    if (!deletingIngredient) return
    setDeleting(true)
    try {
      await removeIngredient(deletingIngredient.id)
      setDeletingIngredient(null)
      showToast('Bahan dinonaktifkan di server.', 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menghapus bahan', 'error')
      setDeletingIngredient(null)
    } finally {
      setDeleting(false)
    }
  }

  // Riwayat per tab: Penerimaan hanya "in", Penyesuaian menampilkan sisanya
  const visibleMovements = movements.filter((m) => (invTab === 'receive' ? m.type === 'in' : m.type !== 'in'))

  function reasonLabel(id?: string | null): string {
    if (!id) return ''
    return ADJUSTMENT_REASONS.find((r) => r.id === id)?.label ?? id
  }

  return (
    <div>
      {/* Header Utama & Tombol Aksi Stok */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[40px] font-semibold tracking-tight">Inventory</h1>
          <p className="text-stone">Penerimaan bahan dari supplier & penyesuaian stok.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              setReceiveForm((f) => ({ ...f, ingredientId: f.ingredientId || ingredients[0]?.id || '' }))
              setReceiveError(null)
              setIsReceiveModalOpen(true)
            }}
            className="flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">inventory_2</span>
            <span>Terima Bahan</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setAdjustForm((f) => ({ ...f, ingredientId: f.ingredientId || ingredients[0]?.id || '' }))
              setAdjustError(null)
              setIsAdjustModalOpen(true)
            }}
            className="flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">tune</span>
            <span>Buat Penyesuaian</span>
          </Button>
        </div>
      </div>

      {/* Tab Penerimaan vs Penyesuaian */}
      <div className="mb-4 flex items-center gap-2">
        {(['receive', 'adjust'] as InventoryTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setInvTab(t)}
            className={`h-[33px] rounded-[12px] px-4 text-xs font-semibold tracking-wider transition-colors ${
              invTab === t ? 'bg-black text-white' : 'bg-sand text-stone hover:bg-[#e6e2d9] hover:text-black'
            }`}
          >
            {t === 'receive' ? 'Penerimaan' : 'Penyesuaian & Riwayat'}
          </button>
        ))}
      </div>

      {toast && (
        <div
          className={`mb-4 rounded-[12px] px-4 py-3 text-sm font-medium ${
            toast.kind === 'error'
              ? 'border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 text-[#ba1a1a]'
              : 'border border-sage/40 bg-[#b8cda9]/30 text-sage'
          }`}
        >
          {toast.msg}
        </div>
      )}
      {loadError && (
        <div className="mb-4 rounded-[12px] border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 px-4 py-3 text-sm text-[#ba1a1a]">
          {loadError}
        </div>
      )}
      {loading && (
        <p className="mb-4 text-xs text-stone">Memuat bahan dari server…</p>
      )}

      {/* Grid Utama Layout: Kolom Kiri (Tabel) & Kolom Kanan (Stock History) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]">
        {/* Kolom Kiri: Baris Search, Tombol Tambah, dan Tabel */}
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-lg text-black">Daftar Bahan</h2>

            <div className="flex items-center gap-3">
              {/* Search Bar */}
              <div className="relative min-w-[200px]">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-stone">
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari bahan..."
                  className="h-10 w-full rounded-[12px] border border-clay/60 bg-white pl-9 pr-3 text-sm outline-none focus:border-black transition-colors"
                />
              </div>

              {/* Tombol Tambah Bahan */}
              <Button onClick={handleOpenAddModal} className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[18px]">add</span>
                <span>Tambah Bahan</span>
              </Button>
            </div>
          </div>

          {/* Tabel Inventaris Bahan */}
          <div className="overflow-hidden rounded-[12px] border border-[#c4c7c7] bg-white shadow-xs">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#ededed] text-[12px] uppercase tracking-wider text-muted border-b border-sand">
                <tr>
                  <th className="px-4 py-3">Ingredient</th>
                  <th className="px-4 py-3">Current</th>
                  <th className="px-4 py-3">Minimum</th>
                  <th className="px-4 py-3">Unit</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredIngredients.map((i) => {
                  const low = i.currentStock <= i.minimumStock
                  const oos = !i.isAvailable || i.currentStock <= 0
                  return (
                    <tr key={i.id} className="border-t border-sand hover:bg-cream/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-black">{i.name}</td>
                      <td className="px-4 py-3 font-semibold">{i.currentStock}</td>
                      <td className="px-4 py-3 text-stone">{i.minimumStock}</td>
                      <td className="px-4 py-3 text-stone">{i.unit}</td>
                      <td className="px-4 py-3 font-semibold">
                        {oos ? (
                          <span className="text-[#ba1a1a]">Out of Stock</span>
                        ) : low ? (
                          <span className="text-[#9a6b2f]">Low Stock</span>
                        ) : (
                          <span className="text-sage">OK</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenEditModal(i)}
                            className="flex size-8 items-center justify-center rounded-lg border border-clay/60 bg-white text-stone hover:border-black hover:text-black transition-colors"
                            title="Edit Bahan"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                          <button
                            onClick={() => setDeletingIngredient(i)}
                            className="flex size-8 items-center justify-center rounded-lg border border-[#ba1a1a]/30 bg-white text-[#ba1a1a] hover:bg-[#ba1a1a]/10 transition-colors"
                            title="Hapus Bahan"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {filteredIngredients.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-muted">
                      Bahan tidak ditemukan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Kolom Kanan: Panel Stock History (Sejajar di Samping Tabel) */}
        <aside className="flex flex-col rounded-[12px] border border-[#c4c7c7] bg-white p-5 h-fit shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-sand pb-3">
            <h3 className="font-semibold text-black text-sm uppercase tracking-wider">Stock History</h3>
            <span className="material-symbols-outlined text-stone text-[20px]">history</span>
          </div>

          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto space-y-3 pr-1">
            {visibleMovements.map((m) => {
              const ingName = ingredients.find((i) => i.id === m.ingredientId)?.name ?? ''
              return (
                <div key={m.id} className="rounded-lg border border-sand bg-white p-3 text-xs shadow-2xs">
                  <div className="flex items-center justify-between font-bold text-black">
                    <span className="uppercase text-stone">
                      {m.type === 'in' ? 'Terima' : m.type === 'adjustment' ? 'Adjustment' : m.type}
                    </span>
                    <span className="font-mono">{m.stockBefore} → {m.stockAfter}</span>
                  </div>
                  {ingName && <p className="mt-1 font-semibold text-black">{ingName}</p>}
                  <p className="mt-0.5 font-semibold text-black">
                    Qty: {m.quantity}{m.type === 'adjustment' && m.quantity > 0 ? ' (+)' : m.type === 'adjustment' ? ' (−)' : ''}
                  </p>
                  {m.type === 'in' && (m.supplier || m.referenceNo) && (
                    <p className="mt-0.5 text-[11px] text-muted">
                      {[m.supplier, m.referenceNo ? `Nota ${m.referenceNo}` : ''].filter(Boolean).join(' · ')}
                      {m.batchNo ? ` · Batch ${m.batchNo}` : ''}
                    </p>
                  )}
                  {m.type === 'adjustment' && m.reason && (
                    <p className="mt-0.5 inline-block rounded-full bg-sand px-2 py-0.5 text-[10px] font-bold text-stone">
                      {reasonLabel(m.reason)}
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] text-muted">{m.notes}</p>
                </div>
              )
            })}

            {visibleMovements.length === 0 && (
              <p className="py-8 text-center text-xs text-muted">
                {invTab === 'receive' ? 'Belum ada penerimaan.' : 'Belum ada penyesuaian.'}
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* POPUP MODALS (Sama Seperti Sebelumnya) */}
      {isIngredientModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-sand pb-3">
              <h3 className="font-semibold text-black">
                {editingIngredientId ? 'Edit Bahan' : 'Tambah Bahan Baru'}
              </h3>
              <button onClick={() => setIsIngredientModalOpen(false)} className="font-bold text-stone">
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3">
              <Field label="Nama Bahan">
                <TextInput
                  value={ingredientForm.name}
                  onChange={(e) => setIngredientForm({ ...ingredientForm, name: e.target.value })}
                  placeholder="Contoh: Biji Kopi Arabika"
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Satuan">
                  <TextInput
                    value={ingredientForm.unit}
                    onChange={(e) => setIngredientForm({ ...ingredientForm, unit: e.target.value })}
                    placeholder="kg / gr / ml"
                  />
                </Field>
                <Field label="Stok Saat Ini">
                  <TextInput
                    type="number"
                    value={ingredientForm.currentStock}
                    onChange={(e) => setIngredientForm({ ...ingredientForm, currentStock: e.target.value })}
                    disabled={editingIngredientId !== null}
                    title={editingIngredientId ? 'Stok hanya berubah via Receive Stock / Adjustment' : undefined}
                  />
                </Field>
                <Field label="Stok Minimum">
                  <TextInput
                    type="number"
                    value={ingredientForm.minimumStock}
                    onChange={(e) => setIngredientForm({ ...ingredientForm, minimumStock: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            {editingIngredientId && (
              <p className="text-[11px] text-stone">Stok saat ini hanya berubah via Receive Stock / Adjustment.</p>
            )}
            {ingredientError && (
              <p className="text-xs font-medium text-[#ba1a1a]">{ingredientError}</p>
            )}

            <div className="flex gap-2 border-t border-sand pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsIngredientModalOpen(false)}>
                Batal
              </Button>
              <Button className="flex-1" disabled={!ingredientForm.name.trim() || savingIngredient} onClick={saveIngredient}>
                {savingIngredient ? 'Menyimpan…' : 'Simpan Bahan'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {isReceiveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[16px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-sand pb-3">
              <div>
                <h3 className="font-semibold text-black">Terima Bahan</h3>
                <p className="text-[11px] text-stone">Penerimaan dari supplier — selalu menambah stok.</p>
              </div>
              <button onClick={() => setIsReceiveModalOpen(false)} className="font-bold text-stone">
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3">
              <Field label="Pilih Bahan">
                <select
                  className="h-12 w-full rounded-[8px] border border-clay bg-white px-3 outline-none focus:border-black"
                  value={receiveForm.ingredientId}
                  onChange={(e) => setReceiveForm({ ...receiveForm, ingredientId: e.target.value })}
                >
                  <option value="">— Pilih bahan —</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (Stok: {i.currentStock} {i.unit})
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Supplier">
                  <TextInput
                    value={receiveForm.supplier}
                    onChange={(e) => setReceiveForm({ ...receiveForm, supplier: e.target.value })}
                    placeholder="Nama supplier"
                  />
                </Field>
                <Field label="No. Nota / PO">
                  <TextInput
                    value={receiveForm.referenceNo}
                    onChange={(e) => setReceiveForm({ ...receiveForm, referenceNo: e.target.value })}
                    placeholder="SJ-001"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Jumlah Diterima">
                  <TextInput
                    type="number"
                    value={receiveForm.quantity}
                    onChange={(e) => setReceiveForm({ ...receiveForm, quantity: e.target.value })}
                  />
                </Field>
                <Field label="Harga / Unit (Rp, opsional)">
                  <TextInput
                    type="number"
                    value={receiveForm.unitCost}
                    onChange={(e) => setReceiveForm({ ...receiveForm, unitCost: e.target.value })}
                    placeholder="0"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Batch (opsional)">
                  <TextInput
                    value={receiveForm.batchNo}
                    onChange={(e) => setReceiveForm({ ...receiveForm, batchNo: e.target.value })}
                    placeholder="B-2026-001"
                  />
                </Field>
                <Field label="Kadaluarsa (opsional)">
                  <TextInput
                    type="date"
                    value={receiveForm.expiryDate}
                    onChange={(e) => setReceiveForm({ ...receiveForm, expiryDate: e.target.value })}
                  />
                </Field>
              </div>

              <Field label="Catatan QC">
                <TextInput
                  value={receiveForm.notes}
                  onChange={(e) => setReceiveForm({ ...receiveForm, notes: e.target.value })}
                  placeholder="Contoh: Lolos QC, segel utuh"
                />
              </Field>
            </div>

            {receiveError && (
              <p className="mb-3 text-xs font-medium text-[#ba1a1a]">{receiveError}</p>
            )}

            <div className="flex gap-2 border-t border-sand pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsReceiveModalOpen(false)}>
                Batal
              </Button>
              <Button className="flex-1" disabled={savingReceive} onClick={handleReceiveStock}>
                {savingReceive ? 'Mencatat…' : 'Catat Penerimaan'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[16px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-sand pb-3">
              <div>
                <h3 className="font-semibold text-black">Penyesuaian Stok</h3>
                <p className="text-[11px] text-stone">Selisih opname/insiden — tercatat dengan alasan (audit).</p>
              </div>
              <button onClick={() => setIsAdjustModalOpen(false)} className="font-bold text-stone">
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3">
              <Field label="Pilih Bahan">
                <select
                  className="h-12 w-full rounded-[8px] border border-clay bg-white px-3 outline-none focus:border-black"
                  value={adjustForm.ingredientId}
                  onChange={(e) => setAdjustForm({ ...adjustForm, ingredientId: e.target.value })}
                >
                  <option value="">— Pilih bahan —</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (Stok: {i.currentStock} {i.unit})
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Arah">
                  <div className="flex h-12 overflow-hidden rounded-[8px] border border-clay">
                    {(['-', '+'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setAdjustForm({ ...adjustForm, direction: d })}
                        className={`flex-1 text-sm font-bold transition-colors ${
                          adjustForm.direction === d ? (d === '-' ? 'bg-[#ba1a1a] text-white' : 'bg-sage text-white') : 'bg-white text-stone'
                        }`}
                      >
                        {d === '-' ? '− Kurang' : '+ Tambah'}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Jumlah">
                  <TextInput
                    type="number"
                    value={adjustForm.quantity}
                    onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
                  />
                </Field>
              </div>

              <Field label="Alasan (wajib)">
                <select
                  className="h-12 w-full rounded-[8px] border border-clay bg-white px-3 outline-none focus:border-black"
                  value={adjustForm.reason}
                  onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                >
                  <option value="">— Pilih alasan —</option>
                  {ADJUSTMENT_REASONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Catatan">
                <TextInput
                  value={adjustForm.notes}
                  onChange={(e) => setAdjustForm({ ...adjustForm, notes: e.target.value })}
                  placeholder="Contoh: Susu tumpah saat restock"
                />
              </Field>
            </div>

            {adjustError && (
              <p className="mb-3 text-xs font-medium text-[#ba1a1a]">{adjustError}</p>
            )}

            <div className="flex gap-2 border-t border-sand pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsAdjustModalOpen(false)}>
                Batal
              </Button>
              <Button className="flex-1" disabled={savingAdjust} onClick={handleAdjustStock}>
                {savingAdjust ? 'Mencatat…' : 'Catat Penyesuaian'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deletingIngredient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-[16px] bg-white p-6 shadow-2xl">
            <h3 className="font-semibold text-black text-base mb-2">Hapus Bahan?</h3>
            <p className="text-sm text-stone mb-6">
              Apakah Anda yakin ingin menghapus bahan <strong className="text-black">&quot;{deletingIngredient.name}&quot;</strong>?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeletingIngredient(null)}>
                Batal
              </Button>
              <Button
                className="bg-[#ba1a1a] hover:bg-[#ba1a1a]/90 text-white"
                disabled={deleting}
                onClick={handleDeleteIngredient}
              >
                {deleting ? 'Menghapus…' : 'Hapus'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}