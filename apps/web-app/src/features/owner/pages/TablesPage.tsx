import { useState } from 'react'
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react'
import { useCafe } from '../../../mock/store'
import { uid } from '../../../shared/lib/format'
import { getSelfOrderUrl } from '../../../shared/lib/qr'
import { Button, Field, TextInput } from '../../../shared/components/ui'
import type { CafeTable, QrConfig } from '../../../shared/types'

// Tipe ekstensi lokal untuk lokasi meja — selaras dengan CafeTable.area?: string di shared/types
type TableArea = 'Indoor' | 'Outdoor' | 'Lantai Atas' | 'Lantai Bawah'

type TableWithArea = CafeTable & { area?: TableArea }

export function TablesPage() {
  const { tables, business, upsertTable, removeTable, regenerateTableQr, saveBusinessSettings } = useCafe()

  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)
  const [saving, setSaving] = useState(false)

  function showToast(msg: string, kind: 'success' | 'error') {
    setToast({ msg, kind })
    window.setTimeout(() => setToast(null), kind === 'error' ? 4000 : 2500)
  }

  // State Modal Tambah Meja
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [tableNumberInput, setTableNumberInput] = useState('')
  const [areaInput, setAreaInput] = useState<TableArea>('Indoor')

  // State Modal Konfirmasi Toggle Status
  const [toggleTarget, setToggleTarget] = useState<CafeTable | null>(null)

  // State Modal Preview & Print QR Code
  const [selectedQRTable, setSelectedQRTable] = useState<CafeTable | null>(null)

  // State Modal Konfirmasi Hapus
  const [deletingTable, setDeletingTable] = useState<CafeTable | null>(null)

  // State Drawer Edit QR (kustom estetika per-meja) — dipertahankan fallback
  const [editingQrTable, setEditingQrTable] = useState<CafeTable | null>(null)
  const [qrDraft, setQrDraft] = useState<QrConfig>({ showLogo: true, showTableNumber: true })
  // State Drawer Edit QR Global (untuk keseluruhan struk)
  const [isGlobalQrOpen, setIsGlobalQrOpen] = useState(false)
  const [globalDraft, setGlobalDraft] = useState<QrConfig>({ showLogo: true, showTableNumber: true })

  // Buka Modal Tambah Meja dengan nomor meja otomatis
  function handleOpenAddModal() {
    const nextNum = String(tables.length + 1).padStart(2, '0')
    setTableNumberInput(nextNum)
    setAreaInput('Indoor')
    setIsAddModalOpen(true)
  }

  // Simpan Meja Baru (qrToken asli dibuat server)
  async function handleSaveNewTable() {
    if (!tableNumberInput.trim() || saving) return
    setSaving(true)
    try {
      const newTable: TableWithArea = {
        id: uid('t'),
        tableNumber: tableNumberInput.trim(),
        qrToken: '',
        isActive: true,
        area: areaInput,
      }
      await upsertTable(newTable, true)
      setIsAddModalOpen(false)
      showToast(`Meja ${tableNumberInput.trim()} tersimpan di server!`, 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan meja', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Konfirmasi Perubahan Status Toggle
  async function handleConfirmToggleStatus() {
    if (!toggleTarget || saving) return
    setSaving(true)
    try {
      await upsertTable({ ...toggleTarget, isActive: !toggleTarget.isActive }, false)
      setToggleTarget(null)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal mengubah status meja', 'error')
      setToggleTarget(null)
    } finally {
      setSaving(false)
    }
  }

  // QR Baru (regenerate token server — untuk QR bocor/bermasalah)
  async function handleRegenerateQr(table: CafeTable) {
    if (saving) return
    setSaving(true)
    try {
      const qrToken = await regenerateTableQr(table.id)
      setSelectedQRTable({ ...table, qrToken })
      showToast(`QR baru Meja ${table.tableNumber} diterbitkan!`, 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menerbitkan QR baru', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteTable() {
    if (!deletingTable || saving) return
    setSaving(true)
    try {
      await removeTable(deletingTable.id)
      setDeletingTable(null)
      showToast('Meja dihapus dari server.', 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menghapus meja', 'error')
      setDeletingTable(null)
    } finally {
      setSaving(false)
    }
  }

  // Fungsi Cetak QR Code — hybrid: coba window baru (Opsi B, isolasi 1:1), fallback ke window.print biasa (Opsi A)
  function handlePrintQR() {
    const card = document.getElementById('printable-qr-card')
    if (!card) {
      window.print()
      return
    }
    // Opsi B: buka window baru khusus cetak A4 polos — hasil 1:1 tanpa sisa layout BackOffice
    const printWindow = window.open('', '_blank', 'width=800,height=600')
    if (!printWindow) {
      window.print()
      return
    }
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((el) => el.outerHTML)
      .join('\n')
    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Cetak QR Meja</title>
          ${styles}
          <style>
            @page { size: A4; margin: 12mm; }
            html, body { height: auto !important; overflow: visible !important; background: #fff !important; margin: 0 !important; }
            body { display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            #printable-qr-card {
              width: 90mm !important; max-width: 90mm !important; margin: 0 auto !important;
              padding: 6mm !important; background: #fff !important; box-shadow: none !important;
              border-width: 2px !important; -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            /* Hasil polos: paksa background cream jadi putih untuk hemat tinta */
            #printable-qr-card.bg-cream, #printable-qr-card .bg-cream { background: #fff !important; }
          </style>
        </head>
        <body>
          ${card.outerHTML}
        </body>
      </html>
    `)
    printWindow.document.close()
    // Tunggu SVG/QR render + font lalu print
    const doPrint = () => {
      printWindow.focus()
      printWindow.print()
      // Jangan close otomatis agar user masih bisa Save as PDF; tutup manual
    }
    if (printWindow.document.readyState === 'complete') setTimeout(doPrint, 300)
    else printWindow.onload = () => setTimeout(doPrint, 300)
  }

  // Unduh QR sebagai PNG (dari canvas tersembunyi di modal preview)
  function handleDownloadQR(table: CafeTable) {
    const canvas = document.getElementById(`qr-download-canvas-${table.id}`) as HTMLCanvasElement | null
    if (!canvas) return
    const pngUrl = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = pngUrl
    a.download = `qr-meja-${table.tableNumber}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function saveQrConfig() {
    if (!editingQrTable || saving) return
    const hasContent =
      qrDraft.title?.trim() ||
      qrDraft.subtitle?.trim() ||
      qrDraft.instruction?.trim() ||
      qrDraft.extraText?.trim() ||
      qrDraft.accentColor !== '#000000' ||
      !qrDraft.showLogo ||
      !qrDraft.showTableNumber
    const cfg: QrConfig | undefined = hasContent
      ? {
          title: qrDraft.title?.trim() || undefined,
          subtitle: qrDraft.subtitle?.trim() || undefined,
          instruction: qrDraft.instruction?.trim() || undefined,
          extraText: qrDraft.extraText?.trim() || undefined,
          showLogo: qrDraft.showLogo,
          showTableNumber: qrDraft.showTableNumber,
          accentColor: qrDraft.accentColor !== '#000000' ? qrDraft.accentColor : undefined,
        }
      : undefined
    setSaving(true)
    try {
      await upsertTable({ ...editingQrTable, qrConfig: cfg }, false)
      setEditingQrTable(null)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan tampilan QR', 'error')
      setEditingQrTable(null)
    } finally {
      setSaving(false)
    }
  }

  function openGlobalQrEditor() {
    const g = business.qrTemplate
    setGlobalDraft({
      title: g?.title ?? '',
      subtitle: g?.subtitle ?? '',
      instruction: g?.instruction ?? '',
      extraText: g?.extraText ?? '',
      showLogo: g?.showLogo ?? true,
      showTableNumber: g?.showTableNumber ?? true,
      accentColor: g?.accentColor ?? '#000000',
    })
    setIsGlobalQrOpen(true)
  }

  async function saveGlobalQr() {
    if (saving) return
    const hasContent =
      globalDraft.title?.trim() ||
      globalDraft.subtitle?.trim() ||
      globalDraft.instruction?.trim() ||
      globalDraft.extraText?.trim() ||
      globalDraft.accentColor !== '#000000' ||
      !globalDraft.showLogo ||
      !globalDraft.showTableNumber
    const cfg: QrConfig | undefined = hasContent
      ? {
          title: globalDraft.title?.trim() || undefined,
          subtitle: globalDraft.subtitle?.trim() || undefined,
          instruction: globalDraft.instruction?.trim() || undefined,
          extraText: globalDraft.extraText?.trim() || undefined,
          showLogo: globalDraft.showLogo,
          showTableNumber: globalDraft.showTableNumber,
          accentColor: globalDraft.accentColor !== '#000000' ? globalDraft.accentColor : undefined,
        }
      : undefined
    setSaving(true)
    try {
      await saveBusinessSettings({ qrTemplate: cfg ?? null })
      setIsGlobalQrOpen(false)
      showToast('Tampilan struk global tersimpan di server!', 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan tampilan global', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Hitung ringkasan statistik meja
  const totalTables = tables.length
  const activeTables = tables.filter((t) => t.isActive).length
  const inactiveTables = totalTables - activeTables

  return (
    <div className="space-y-6 pb-12">
      {/* CSS Cetak A4 Polos — Opsi A (fallback Ctrl+P tanpa window baru) */}
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
          /* Sembunyikan sidebar/header BackOffice agar tidak ganggu posisi QR */
          aside, header, nav { display: none !important; }
          body * { visibility: hidden; }
          #printable-qr-card, #printable-qr-card * { visibility: visible; }
          #printable-qr-card {
            position: absolute;
            left: 50%; top: 50%; transform: translate(-50%, -50%);
            width: 90mm !important; max-width: 90mm !important;
            margin: 0 auto !important; padding: 6mm !important;
            display: block !important; box-shadow: none !important;
            background: #fff !important; /* polos hemat tinta */
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          #printable-qr-card.bg-cream, #printable-qr-card .bg-cream { background: #fff !important; }
        }
      `}</style>

      {/* Header Utama & Ringkasan */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Floor Plan & Meja</h1>
          <p className="text-stone">Kelola tata letak meja dan QR Code self-order pelanggan.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openGlobalQrEditor} className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
            <span>Edit Struk</span>
          </Button>
          <Button onClick={handleOpenAddModal} className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Tambah Meja</span>
          </Button>
        </div>
      </div>

      {toast && (
        <div
          className={`rounded-[12px] px-4 py-3 text-sm font-medium ${
            toast.kind === 'error'
              ? 'border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 text-[#ba1a1a]'
              : 'border border-sage/40 bg-[#b8cda9]/30 text-sage'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Ringkasan Statistik Meja */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <article className="rounded-[12px] border border-[#c4c7c7] bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Total Meja</p>
          <p className="mt-2 text-[28px] font-bold text-black">{totalTables} Meja</p>
        </article>
        <article className="rounded-[12px] border border-[#c4c7c7] bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Meja Aktif</p>
          <p className="mt-2 text-[28px] font-bold text-sage">{activeTables} Aktif</p>
        </article>
        <article className="rounded-[12px] border border-[#c4c7c7] bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Meja Inaktif</p>
          <p className="mt-2 text-[28px] font-bold text-[#ba1a1a]">{inactiveTables} Inaktif</p>
        </article>
      </div>

      {/* Grid Kartu Meja */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {tables.map((t) => (
          <article
            key={t.id}
            className="flex flex-col justify-between rounded-[16px] border border-[#c4c7c7] bg-white p-5 shadow-sm transition-all hover:shadow-md"
          >
            <div>
              {/* Header Kartu: Nomor Meja & Toggle Status */}
              <div className="mb-3 flex items-center justify-between border-b border-sand pb-3">
                <div>
                  <h3 className="font-display text-xl font-bold text-black">Meja {t.tableNumber}</h3>
                  <span className="rounded-md bg-sand px-2 py-0.5 text-[10px] font-bold text-stone">
                    {t.area || 'Indoor'}
                  </span>
                </div>

                {/* Custom iOS Toggle Switch */}
                <button
                  type="button"
                  onClick={() => setToggleTarget(t)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    t.isActive ? 'bg-sage' : 'bg-clay/50'
                  }`}
                  title={t.isActive ? 'Klik untuk nonaktifkan' : 'Klik untuk aktifkan'}
                >
                  <span
                    className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      t.isActive ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* QR Mini Real (scan -> self-order meja ini) */}
              <div className="mb-4 flex flex-col items-center justify-center gap-2 rounded-lg border border-sand bg-cream/40 p-4">
                <div className={t.isActive ? '' : 'opacity-40 grayscale'}>
                  <QRCodeSVG value={getSelfOrderUrl(t.qrToken)} size={72} level="M" bgColor="#ffffff" fgColor="#000000" />
                </div>
                {!t.isActive && <p className="text-[10px] font-semibold uppercase text-[#ba1a1a]">Meja nonaktif</p>}
              </div>
              {/* <p className="mb-4 truncate text-center text-xs text-stone">/order/{t.qrToken}</p> */}
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center gap-2 border-t border-sand pt-3">
              <Button variant="outline" className="flex-1 text-xs" onClick={() => setSelectedQRTable(t)}>
                <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
                <span>Buka QR</span>
              </Button>
              <button
                className="flex size-9 items-center justify-center rounded-lg border border-[#ba1a1a]/30 bg-white text-[#ba1a1a] hover:bg-[#ba1a1a]/10 transition-colors"
                onClick={() => setDeletingTable(t)}
                title="Hapus Meja"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          </article>
        ))}
      </div>

      {/* MODAL 1: TAMBAH MEJA BARU */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-sand pb-3">
              <h3 className="font-bold text-black text-base">Tambah Meja Baru</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="font-bold text-stone">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <Field label="Nomor Meja">
                <TextInput
                  value={tableNumberInput}
                  onChange={(e) => setTableNumberInput(e.target.value)}
                  placeholder="Contoh: 01 / 12A"
                  autoFocus
                />
              </Field>

              <Field label="Area / Lokasi Meja">
                <select
                  value={areaInput}
                  onChange={(e) => setAreaInput(e.target.value as TableArea)}
                  className="h-10 w-full rounded-lg border border-clay bg-white px-3 text-sm font-semibold outline-none focus:border-black"
                >
                  <option value="Indoor">Indoor (Dalam Ruangan)</option>
                  <option value="Outdoor">Outdoor (Area Luar)</option>
                  <option value="Lantai Atas">Lantai Atas</option>
                  {/* <option value="Lantai Bawah">Lantai Bawah (Utama)</option> */}
                </select>
              </Field>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-sand pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsAddModalOpen(false)}>
                Batal
              </Button>
              <Button className="flex-1" disabled={!tableNumberInput.trim() || saving} onClick={handleSaveNewTable}>
                {saving ? 'Menyimpan…' : 'Simpan Meja'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: KONFIRMASI TOGGLE STATUS */}
      {toggleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-[16px] bg-white p-6 shadow-2xl">
            <h3 className="font-semibold text-black text-base mb-2">Ubah Status Meja?</h3>
            <p className="text-sm text-stone mb-6">
              Apakah Anda yakin ingin mengubah status <strong>Meja {toggleTarget.tableNumber}</strong> menjadi{' '}
              <strong className={toggleTarget.isActive ? 'text-[#ba1a1a]' : 'text-sage'}>
                {toggleTarget.isActive ? 'Inaktif' : 'Aktif'}
              </strong>
              ?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setToggleTarget(null)}>
                Batal
              </Button>
              <Button onClick={handleConfirmToggleStatus} disabled={saving}>
                {saving ? 'Menyimpan…' : 'Ya, Ubah Status'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: PREVIEW & PRINT QR CODE UNIK */}
      {selectedQRTable &&
        (() => {
          const globalCfg = business.qrTemplate
          const cfg = selectedQRTable.qrConfig
          const merged: QrConfig = {
            title: globalCfg?.title ?? cfg?.title,
            subtitle: globalCfg?.subtitle ?? cfg?.subtitle,
            instruction: globalCfg?.instruction ?? cfg?.instruction,
            extraText: globalCfg?.extraText ?? cfg?.extraText,
            showLogo: globalCfg?.showLogo ?? cfg?.showLogo ?? true,
            showTableNumber: globalCfg?.showTableNumber ?? cfg?.showTableNumber ?? true,
            accentColor: globalCfg?.accentColor ?? cfg?.accentColor,
          }
          const qrTitle = merged.title?.trim() || business.name
          const qrSubtitle = merged.subtitle?.trim() || (selectedQRTable.area || 'Indoor')
          const qrInstruction = merged.instruction?.trim() || 'SCAN ME TO ORDER'
          const qrExtra = merged.extraText?.trim() || 'Pesan & bayar langsung dari meja Anda'
          const qrShowLogo = merged.showLogo ?? true
          const qrShowTable = merged.showTableNumber ?? true
          const qrAccent = merged.accentColor || '#000000'
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
              <div className="w-full max-w-md rounded-[20px] bg-white p-6 shadow-2xl flex flex-col items-center">
                <div className="w-full flex justify-between items-center border-b border-sand pb-3 mb-4">
                  <span className="font-bold text-black text-sm uppercase tracking-wider">Pratinjau QR Code</span>
                  <button onClick={() => setSelectedQRTable(null)} className="font-bold text-stone">
                    ✕
                  </button>
                </div>

                <div
                  id="printable-qr-card"
                  className="w-full max-w-xs rounded-2xl border-2 bg-cream p-6 shadow-md text-center space-y-4"
                  style={{ borderColor: qrAccent }}
                >
                  <div className="border-b-2 pb-3" style={{ borderColor: qrAccent }}>
                    {qrShowLogo &&
                      (business.logoUrl ? (
                        <img src={business.logoUrl} alt="Logo" className="mx-auto mb-2 size-10 rounded-full object-cover border" />
                      ) : (
                        <div className="mx-auto mb-1 flex size-10 items-center justify-center rounded-full text-white" style={{ background: qrAccent }}>
                          <span className="material-symbols-outlined text-[20px]">local_cafe</span>
                        </div>
                      ))}
                    {!qrShowLogo && <div className="mx-auto mb-1 flex size-10 items-center justify-center rounded-full text-white" style={{ background: qrAccent }}><span className="material-symbols-outlined text-[20px]">local_cafe</span></div>}
                    <h2 className="font-display text-xl font-bold uppercase tracking-tight" style={{ color: qrAccent }}>
                      {qrTitle}
                    </h2>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-stone">{qrSubtitle}</p>
                  </div>

                  <div className="mx-auto flex size-44 items-center justify-center rounded-xl bg-white p-3 border-2 shadow-xs" style={{ borderColor: qrAccent }}>
                    <QRCodeSVG
                      value={getSelfOrderUrl(selectedQRTable.qrToken)}
                      size={152}
                      level="H"
                      bgColor="#ffffff"
                      fgColor="#000000"
                      imageSettings={
                        qrShowLogo && business.logoUrl
                          ? { src: business.logoUrl, x: undefined, y: undefined, height: 36, width: 36, excavate: true }
                          : undefined
                      }
                    />
                  </div>
                  {!selectedQRTable.isActive && (
                    <p className="mt-1 rounded bg-[#ba1a1a]/10 px-2 py-1 text-[10px] font-bold uppercase text-[#ba1a1a]">
                      Meja nonaktif — QR tidak akan membuka self-order
                    </p>
                  )}
                  {/* Canvas tersembunyi untuk Download PNG */}
                  <div className="hidden">
                    <QRCodeCanvas
                      id={`qr-download-canvas-${selectedQRTable.id}`}
                      value={getSelfOrderUrl(selectedQRTable.qrToken)}
                      size={512}
                      level="H"
                      bgColor="#ffffff"
                      fgColor="#000000"
                      imageSettings={
                        qrShowLogo && business.logoUrl
                          ? { src: business.logoUrl, x: undefined, y: undefined, height: 120, width: 120, excavate: true }
                          : undefined
                      }
                    />
                  </div>

                  <div>
                    {qrShowTable && (
                      <span className="inline-block rounded-lg px-4 py-1 text-xs font-bold text-white uppercase tracking-wider mb-2" style={{ background: qrAccent }}>
                        MEJA {selectedQRTable.tableNumber}
                      </span>
                    )}
                    <p className="text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-1" style={{ color: qrAccent }}>
                      <span className="material-symbols-outlined text-[16px]">qr_code_scanner</span>
                      <span>{qrInstruction}</span>
                    </p>
                    <p className="text-[9px] text-stone mt-1">{qrExtra}</p>
                  </div>
                </div>

                <p className="mt-1 break-all text-[10px] text-stone">{getSelfOrderUrl(selectedQRTable.qrToken)}</p>

                <div className="mt-6 grid w-full grid-cols-2 gap-2">
                  <Button variant="outline" className="flex items-center justify-center gap-2" onClick={() => setSelectedQRTable(null)}>
                    Batal
                  </Button>
                  <Button
                    variant="outline"
                    className="flex items-center justify-center gap-2"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(getSelfOrderUrl(selectedQRTable.qrToken))
                        showToast('Link meja tersalin!', 'success')
                      } catch {
                        showToast('Gagal menyalin link', 'error')
                      }
                    }}
                  >
                    <span className="material-symbols-outlined text-[18px]">link</span>
                    <span>Salin Link</span>
                  </Button>
                  <Button variant="outline" className="flex items-center justify-center gap-2" onClick={() => selectedQRTable && handleDownloadQR(selectedQRTable)}>
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    <span>Download</span>
                  </Button>
                  <Button variant="outline" className="flex items-center justify-center gap-2" disabled={saving} onClick={() => selectedQRTable && handleRegenerateQr(selectedQRTable)}>
                    <span className="material-symbols-outlined text-[18px]">refresh</span>
                    <span>{saving ? '…' : 'QR Baru'}</span>
                  </Button>
                  <Button className="col-span-2 flex items-center justify-center gap-2" onClick={handlePrintQR}>
                    <span className="material-symbols-outlined text-[18px]">print</span>
                    <span>Cetak QR</span>
                  </Button>
                </div>
              </div>
            </div>
          )
        })()}

      {/* DRAWER: EDIT QR GLOBAL */}
      {isGlobalQrOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
          <div className="flex h-full w-full max-w-[380px] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-sand px-5 py-4">
              <div>
                <h3 className="font-bold text-black">Edit Struk (Global)</h3>
                <p className="text-xs text-stone">Kustom untuk semua QR meja. Fallback per-meja tetap ada.</p>
              </div>
              <button onClick={() => setIsGlobalQrOpen(false)} className="flex size-8 items-center justify-center rounded-lg border border-clay/60 text-stone">
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="rounded-xl border border-sand bg-cream/40 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Preview</p>
                <div className="mt-2 rounded-xl border-2 bg-cream p-4 text-center" style={{ borderColor: globalDraft.accentColor || '#000' }}>
                  <div className="border-b-2 pb-2" style={{ borderColor: globalDraft.accentColor || '#000' }}>
                    {globalDraft.showLogo && business.logoUrl && <img src={business.logoUrl} alt="Logo" className="mx-auto mb-1 size-8 rounded-full object-cover border" />}
                    <p className="font-display text-sm font-bold uppercase" style={{ color: globalDraft.accentColor || '#000' }}>{globalDraft.title?.trim() || business.name}</p>
                    <p className="text-[10px] uppercase text-stone">{globalDraft.subtitle?.trim() || 'Indoor'}</p>
                  </div>
                  <div className="mx-auto mt-2 flex size-20 items-center justify-center rounded bg-white border p-1" style={{ borderColor: globalDraft.accentColor || '#000' }}>
                    <QRCodeSVG value={getSelfOrderUrl('table-01')} size={72} level="M" bgColor="#ffffff" fgColor="#000000" />
                  </div>
                  {globalDraft.showTableNumber && <p className="mt-2 inline-block rounded px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: globalDraft.accentColor || '#000' }}>MEJA XX</p>}
                  <p className="mt-1 text-[10px] font-bold uppercase" style={{ color: globalDraft.accentColor || '#000' }}>{globalDraft.instruction?.trim() || 'SCAN ME TO ORDER'}</p>
                  {globalDraft.extraText?.trim() && <p className="text-[9px] text-stone">{globalDraft.extraText}</p>}
                </div>
              </div>
              <Field label="Judul (default: nama bisnis)">
                <TextInput value={globalDraft.title ?? ''} onChange={(e) => setGlobalDraft({ ...globalDraft, title: e.target.value })} placeholder={business.name} />
              </Field>
              <Field label="Subjudul">
                <TextInput value={globalDraft.subtitle ?? ''} onChange={(e) => setGlobalDraft({ ...globalDraft, subtitle: e.target.value })} placeholder="Indoor" />
              </Field>
              <Field label="Instruksi">
                <TextInput value={globalDraft.instruction ?? ''} onChange={(e) => setGlobalDraft({ ...globalDraft, instruction: e.target.value })} placeholder="SCAN ME TO ORDER" />
              </Field>
              <Field label="Teks tambahan">
                <TextInput value={globalDraft.extraText ?? ''} onChange={(e) => setGlobalDraft({ ...globalDraft, extraText: e.target.value })} placeholder="Pesan & bayar langsung..." />
              </Field>
              <Field label="Warna Aksen">
                <input type="color" value={globalDraft.accentColor || '#000000'} onChange={(e) => setGlobalDraft({ ...globalDraft, accentColor: e.target.value })} className="h-10 w-full rounded-lg border border-clay p-1" />
              </Field>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={globalDraft.showLogo} onChange={(e) => setGlobalDraft({ ...globalDraft, showLogo: e.target.checked })} className="size-4" />
                Tampilkan Logo
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={globalDraft.showTableNumber} onChange={(e) => setGlobalDraft({ ...globalDraft, showTableNumber: e.target.checked })} className="size-4" />
                Tampilkan Nomor Meja
              </label>
            </div>
            <div className="flex gap-2 border-t border-sand px-5 py-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsGlobalQrOpen(false)}>Batal</Button>
              <Button variant="outline" className="flex-1" onClick={() => setGlobalDraft({ showLogo: true, showTableNumber: true, accentColor: '#000000' })}>Reset</Button>
              <Button className="flex-1" onClick={saveGlobalQr}>Simpan</Button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER: EDIT QR ESTETIKA (sidebar kanan) per-meja — dipertahankan fallback */}
      {editingQrTable && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
          <div className="flex h-full w-full max-w-[380px] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-sand px-5 py-4">
              <div>
                <h3 className="font-bold text-black">Edit QR Meja {editingQrTable.tableNumber}</h3>
                <p className="text-xs text-stone">Kustom kata, logo & warna untuk estetika meja.</p>
              </div>
              <button onClick={() => setEditingQrTable(null)} className="flex size-8 items-center justify-center rounded-lg border border-clay/60 text-stone">
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="rounded-xl border border-sand bg-cream/40 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-stone">Preview</p>
                <div className="mt-2 rounded-xl border-2 bg-cream p-4 text-center" style={{ borderColor: qrDraft.accentColor || '#000' }}>
                  <div className="border-b-2 pb-2" style={{ borderColor: qrDraft.accentColor || '#000' }}>
                    {qrDraft.showLogo && business.logoUrl && <img src={business.logoUrl} alt="Logo" className="mx-auto mb-1 size-8 rounded-full object-cover border" />}
                    <p className="font-display text-sm font-bold uppercase" style={{ color: qrDraft.accentColor || '#000' }}>{qrDraft.title?.trim() || business.name}</p>
                    <p className="text-[10px] uppercase text-stone">{qrDraft.subtitle?.trim() || editingQrTable.area || 'Indoor'}</p>
                  </div>
                  <div className="mx-auto mt-2 flex size-20 items-center justify-center rounded bg-white border p-1" style={{ borderColor: qrDraft.accentColor || '#000' }}>
                    <QRCodeSVG
                      value={getSelfOrderUrl(editingQrTable.qrToken)}
                      size={72}
                      level="H"
                      bgColor="#ffffff"
                      fgColor="#000000"
                      imageSettings={
                        qrDraft.showLogo && business.logoUrl
                          ? { src: business.logoUrl, x: undefined, y: undefined, height: 18, width: 18, excavate: true }
                          : undefined
                      }
                    />
                  </div>
                  {qrDraft.showTableNumber && <p className="mt-2 inline-block rounded px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: qrDraft.accentColor || '#000' }}>MEJA {editingQrTable.tableNumber}</p>}
                  <p className="mt-1 text-[10px] font-bold uppercase" style={{ color: qrDraft.accentColor || '#000' }}>{qrDraft.instruction?.trim() || 'SCAN ME TO ORDER'}</p>
                </div>
              </div>

              <Field label="Judul (default: nama bisnis)">
                <TextInput value={qrDraft.title ?? ''} onChange={(e) => setQrDraft({ ...qrDraft, title: e.target.value })} placeholder={business.name} />
              </Field>
              <Field label="Subjudul (default: area meja)">
                <TextInput value={qrDraft.subtitle ?? ''} onChange={(e) => setQrDraft({ ...qrDraft, subtitle: e.target.value })} placeholder={editingQrTable.area || 'Indoor'} />
              </Field>
              <Field label="Instruksi">
                <TextInput value={qrDraft.instruction ?? ''} onChange={(e) => setQrDraft({ ...qrDraft, instruction: e.target.value })} placeholder="SCAN ME TO ORDER" />
              </Field>
              <Field label="Teks tambahan">
                <TextInput value={qrDraft.extraText ?? ''} onChange={(e) => setQrDraft({ ...qrDraft, extraText: e.target.value })} placeholder="Pesan & bayar langsung..." />
              </Field>
              <Field label="Warna Aksen">
                <input type="color" value={qrDraft.accentColor || '#000000'} onChange={(e) => setQrDraft({ ...qrDraft, accentColor: e.target.value })} className="h-10 w-full rounded-lg border border-clay p-1" />
              </Field>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={qrDraft.showLogo} onChange={(e) => setQrDraft({ ...qrDraft, showLogo: e.target.checked })} className="size-4" />
                Tampilkan Logo
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={qrDraft.showTableNumber} onChange={(e) => setQrDraft({ ...qrDraft, showTableNumber: e.target.checked })} className="size-4" />
                Tampilkan Nomor Meja
              </label>
            </div>

            <div className="flex gap-2 border-t border-sand px-5 py-4">
              <Button variant="outline" className="flex-1" onClick={() => setEditingQrTable(null)}>
                Batal
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setQrDraft({ showLogo: true, showTableNumber: true, accentColor: '#000000' })
                }}
              >
                Reset
              </Button>
              <Button className="flex-1" onClick={saveQrConfig}>
                Simpan
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: KONFIRMASI HAPUS MEJA */}
      {deletingTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-[16px] bg-white p-6 shadow-2xl">
            <h3 className="font-semibold text-black text-base mb-2">Hapus Meja?</h3>
            <p className="text-sm text-stone mb-6">
              Apakah Anda yakin ingin menghapus <strong>Meja {deletingTable.tableNumber}</strong>?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeletingTable(null)}>
                Batal
              </Button>
              <Button
                className="bg-[#ba1a1a] hover:bg-[#ba1a1a]/90 text-white"
                disabled={saving}
                onClick={handleDeleteTable}
              >
                {saving ? 'Menghapus…' : 'Hapus'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}