import { useEffect, useState } from 'react'
import { useCafe } from '../../../mock/store'
import { Button, Field, TextInput } from '../../../shared/components/ui'
import { formatRupiah } from '../../../shared/lib/format'
import { subscribeStream } from '../../../lib/stream'
import {
  buildTestPatternBytes,
  connectBluetoothPrinter,
  connectUsbPrinter,
  disconnectBluetoothPrinter,
  disconnectUsbPrinter,
  isBluetoothConnected,
  isBluetoothSupported,
  isUsbConnected,
  isUsbSupported,
  loadPrinterConfig,
  printViaBluetooth,
  printViaUsb,
  savePrinterConfig,
} from '../../../lib/printer'
import {
  ensureBrowserNotifyPermission,
  isBrowserNotifyEnabled,
  setBrowserNotifyEnabled,
} from '../../../lib/sound'
import { usePosTheme } from '../../../lib/pos-theme'

type SettingCategory = 'device' | 'cash' | 'account'
type PrinterConnectionType = 'bluetooth' | 'usb' | 'lan'

export function PosSettingsPage() {
  const { session, logout, business, saveCashSettings, refreshBusinessFromBackend, orders } = useCafe()
  const { theme, setTheme } = usePosTheme()
  const [activeCategory, setActiveCategory] = useState<SettingCategory>('device')

  const savedPrinter = loadPrinterConfig()
  const [printerType, setPrinterType] = useState<PrinterConnectionType>(savedPrinter.type)
  const [printerStatus, setPrinterStatus] = useState<string>('Disconnected')
  const [printerBusy, setPrinterBusy] = useState(false)
  const [printerError, setPrinterError] = useState<string | null>(null)
  const [ipAddress, setIpAddress] = useState(savedPrinter.ip ?? '192.168.1.200')
  const [port, setPort] = useState(savedPrinter.port ?? '9100')

  // Persistensi per perangkat (bukan data bisnis): tipe + IP/port LAN
  useEffect(() => {
    savePrinterConfig({ type: printerType, ip: ipAddress, port })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printerType, ipAddress, port])
  const [openingCashInput, setOpeningCashInput] = useState(String(business.openingCash ?? 0))
  const [cashSaved, setCashSaved] = useState(false)
  const [cashLoading, setCashLoading] = useState(true)
  const [cashSaving, setCashSaving] = useState(false)
  const [cashError, setCashError] = useState<string | null>(null)
  const [soundSaving, setSoundSaving] = useState(false)
  const [soundError, setSoundError] = useState<string | null>(null)
  const [browserNotify, setBrowserNotify] = useState(() => isBrowserNotifyEnabled())
  const [browserNotifyError, setBrowserNotifyError] = useState<string | null>(null)

  // Muat modal kas & suara asli dari BE (bukan seed), + sinkron antar-perangkat via socket.
  useEffect(() => {
    let cancelled = false
    setCashLoading(true)
    refreshBusinessFromBackend()
      .catch(() => {
        if (!cancelled) setCashError('Backend tidak terjangkau — menampilkan data lokal.')
      })
      .finally(() => {
        if (!cancelled) setCashLoading(false)
      })
    let cleanup: (() => void) | undefined
    try {
      const token = localStorage.getItem('servopay_token') || undefined
      const handler = () => refreshBusinessFromBackend().catch(() => {})
      cleanup = subscribeStream({ token, handlers: { 'business:cash_updated': handler } })
    } catch {}
    return () => {
      cancelled = true
      if (cleanup) cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sinkronkan input saat nilai BE tiba (jangan timpa saat user sedang menyimpan)
  useEffect(() => {
    if (!cashSaving) setOpeningCashInput(String(business.openingCash ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.openingCash])

  const cashPaidTotal = orders.filter((o) => o.paymentStatus === 'paid' && o.paymentMethod === 'cash').reduce((s, o) => s + o.total, 0)
  const expectedCash = (business.openingCash ?? 0) + cashPaidTotal
  const [closingCashInput, setClosingCashInput] = useState(
    business.closingCash !== null && business.closingCash !== undefined ? String(business.closingCash) : '',
  )
  const [cashClosing, setCashClosing] = useState(false)
  const closingPreview = closingCashInput.trim() === '' || !Number.isFinite(Number(closingCashInput))
    ? null
    : Number(closingCashInput) - expectedCash
  const cashVariance = business.closingCash !== null && business.closingCash !== undefined
    ? business.closingCash - expectedCash
    : null

  // Sinkronkan input closing saat nilai BE tiba
  useEffect(() => {
    if (!cashSaving && !cashClosing) {
      setClosingCashInput(
        business.closingCash !== null && business.closingCash !== undefined ? String(business.closingCash) : '',
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.closingCash])

  function pickPrinterType(t: PrinterConnectionType) {
    setPrinterType(t)
    setPrinterError(null)
    setPrinterStatus(
      t === 'bluetooth'
        ? isBluetoothConnected() ? 'Connected' : 'Disconnected'
        : t === 'usb'
          ? isUsbConnected() ? 'Connected' : 'Disconnected'
          : 'Simulasi (proxy backend menyusul)',
    )
  }

  async function handleConnectPrinter() {
    setPrinterBusy(true)
    setPrinterError(null)
    setPrinterStatus('Menghubungkan…')
    try {
      const name = printerType === 'bluetooth' ? await connectBluetoothPrinter() : await connectUsbPrinter()
      setPrinterStatus(`Connected: ${name}`)
      savePrinterConfig({ type: printerType, deviceName: name, ip: ipAddress, port })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal menghubungkan'
      setPrinterError(msg)
      setPrinterStatus('Disconnected')
    } finally {
      setPrinterBusy(false)
    }
  }

  async function handleDisconnectPrinter() {
    if (printerType === 'bluetooth') disconnectBluetoothPrinter()
    else await disconnectUsbPrinter().catch(() => {})
    setPrinterStatus('Disconnected')
  }

  async function handlePrintTestPattern() {
    const connected = printerType === 'bluetooth' ? isBluetoothConnected() : isUsbConnected()
    if (!connected) {
      setPrinterError('Belum terhubung — hubungkan printer dulu.')
      return
    }
    setPrinterBusy(true)
    setPrinterError(null)
    try {
      const bytes = buildTestPatternBytes()
      if (printerType === 'bluetooth') await printViaBluetooth(bytes)
      else await printViaUsb(bytes)
      setPrinterStatus((s) => (s.startsWith('Connected') ? s : 'Connected'))
    } catch (e) {
      setPrinterError(e instanceof Error ? e.message : 'Gagal mencetak pola tes')
    } finally {
      setPrinterBusy(false)
    }
  }

  function handleLanSimulatedTest() {
    // JUJUR: browser tidak bisa buka TCP ke printer — ini hanya validasi + simpan config.
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ipAddress.trim())) {
      setPrinterError('Format IP tidak valid (contoh: 192.168.1.200).')
      return
    }
    setPrinterError(null)
    savePrinterConfig({ type: 'lan', ip: ipAddress, port })
    setPrinterStatus(`Simulasi tersimpan: ${ipAddress}:${port} (proxy backend menyusul)`)
  }

  async function handleSaveCash() {
    const val = Math.max(0, Number(openingCashInput) || 0)
    setCashSaving(true)
    setCashError(null)
    try {
      await saveCashSettings({ openingCash: val })
      setCashSaved(true)
      setTimeout(() => setCashSaved(false), 2500)
    } catch (e) {
      setCashError(e instanceof Error ? e.message : 'Gagal menyimpan modal kas')
    } finally {
      setCashSaving(false)
    }
  }

  async function handleCloseShift() {
    if (closingCashInput.trim() === '' || !Number.isFinite(Number(closingCashInput))) {
      setCashError('Isi uang closing dulu (angka).')
      return
    }
    const val = Math.max(0, Number(closingCashInput))
    setCashClosing(true)
    setCashError(null)
    try {
      await saveCashSettings({ closingCash: val })
      setCashSaved(true)
      setTimeout(() => setCashSaved(false), 2500)
    } catch (e) {
      setCashError(e instanceof Error ? e.message : 'Gagal menutup shift')
    } finally {
      setCashClosing(false)
    }
  }

  async function handleReopenShift() {
    setCashClosing(true)
    setCashError(null)
    try {
      await saveCashSettings({ closingCash: null })
      setClosingCashInput('')
    } catch (e) {
      setCashError(e instanceof Error ? e.message : 'Gagal membuka shift')
    } finally {
      setCashClosing(false)
    }
  }

  async function handleToggleSound() {
    setSoundSaving(true)
    setSoundError(null)
    try {
      await saveCashSettings({ soundEnabled: !business.soundEnabled })
    } catch (e) {
      setSoundError(e instanceof Error ? e.message : 'Gagal menyimpan pengaturan suara')
    } finally {
      setSoundSaving(false)
    }
  }

  return (
    <div>
      <h1 className="font-display text-[40px] font-semibold tracking-tight">POS Settings</h1>
      <p className="mb-6 text-stone">Atur perangkat, modal kas, dan sesi pengguna.</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="flex flex-col gap-2 rounded-[12px] border border-[#c4c7c7] bg-white p-3 h-fit shadow-sm">
          <button
            onClick={() => setActiveCategory('device')}
            className={`flex items-center gap-3 rounded-[10px] px-4 py-3 text-sm font-semibold transition-all ${
              activeCategory === 'device' ? 'bg-black text-white shadow-xs' : 'text-stone hover:bg-sand hover:text-black'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">devices</span>
            <span>Perangkat</span>
          </button>
          <button
            onClick={() => setActiveCategory('cash')}
            className={`flex items-center gap-3 rounded-[10px] px-4 py-3 text-sm font-semibold transition-all ${
              activeCategory === 'cash' ? 'bg-black text-white shadow-xs' : 'text-stone hover:bg-sand hover:text-black'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">payments</span>
            <span>Modal Kas</span>
          </button>
          <button
            onClick={() => setActiveCategory('account')}
            className={`flex items-center gap-3 rounded-[10px] px-4 py-3 text-sm font-semibold transition-all ${
              activeCategory === 'account' ? 'bg-black text-white shadow-xs' : 'text-stone hover:bg-sand hover:text-black'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">account_circle</span>
            <span>Akun & Sesi</span>
          </button>
        </aside>

        <main className="rounded-[12px] border border-[#c4c7c7] bg-white p-6 shadow-xs">
          {activeCategory === 'device' && (
            <div className="space-y-6">
              {/* Tema tampilan: preferensi perangkat, langsung berubah & tersimpan */}
              <div className="rounded-[12px] border border-sand bg-[#f9f9f9] p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-black">Tema Tampilan</p>
                    <p className="text-xs text-stone">
                      Pilih terang atau gelap untuk perangkat ini. Pilihan langsung diterapkan dan tetap tersimpan setelah refresh.
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label="Tema tampilan POS"
                    className="flex shrink-0 self-start gap-1 rounded-[10px] border border-[#c4c7c7] bg-white p-1 sm:self-auto"
                  >
                    {([
                      { id: 'light', label: 'Light', icon: 'light_mode' },
                      { id: 'dark', label: 'Dark', icon: 'dark_mode' },
                    ] as const).map((option) => {
                      const active = theme === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setTheme(option.id)}
                          className={`flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-xs font-semibold transition-colors ${
                            active
                              ? 'bg-black text-white shadow-xs'
                              : 'text-stone hover:bg-sand hover:text-black'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[16px]">{option.icon}</span>
                          <span>{option.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              {/* Sound toggle di atas thermal printer */}
              <div className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-semibold text-black">Notifikasi Suara Pesanan Masuk</p>
                  <p className="text-xs text-stone">Bunyikan saat ada pesanan self-order baru.</p>
                </div>
                <button
                  type="button"
                  disabled={soundSaving}
                  onClick={handleToggleSound}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:cursor-wait disabled:opacity-60 ${business.soundEnabled ? 'bg-sage' : 'bg-clay/50'}`}
                >
                  <span className={`inline-block size-5 transform rounded-full bg-white shadow transition ${business.soundEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              {soundError && (
                <p className="text-xs font-medium text-[#ba1a1a]">{soundError}</p>
              )}
              {/* <hr className="border-sand" /> */}
              {/* Notifikasi browser (opsional): muncul saat tab kasir tidak fokus */}
              <div className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-semibold text-black">Notifikasi Browser</p>
                  <p className="text-xs text-stone">Tampilkan notifikasi sistem saat tab tidak aktif.</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setBrowserNotifyError(null)
                    if (!browserNotify) {
                      const granted = await ensureBrowserNotifyPermission()
                      if (!granted) {
                        setBrowserNotifyError('Izin notifikasi ditolak browser.')
                        return
                      }
                    }
                    const next = !browserNotify
                    setBrowserNotify(next)
                    setBrowserNotifyEnabled(next)
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${browserNotify ? 'bg-sage' : 'bg-clay/50'}`}
                >
                  <span className={`inline-block size-5 transform rounded-full bg-white shadow transition ${browserNotify ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              {browserNotifyError && (
                <p className="text-xs font-medium text-[#ba1a1a]">{browserNotifyError}</p>
              )}
              <div>
                <h2 className="text-xl font-semibold text-black">Konfigurasi Thermal Printer</h2>
                <p className="text-xs text-stone mt-1">Pilih jenis koneksi printer nota fisik yang terhubung dengan perangkat kasir.</p>
              </div>
              <hr className="border-sand" />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => pickPrinterType('bluetooth')}
                  className={`flex flex-col items-center justify-center rounded-[12px] border p-4 text-center transition-all ${
                    printerType === 'bluetooth' ? 'border-black bg-[#ededed] font-bold text-black ring-1 ring-black' : 'border-clay/60 bg-white text-stone hover:border-black'
                  }`}
                >
                  <span className="material-symbols-outlined mb-2 text-2xl">bluetooth</span>
                  <span className="text-xs uppercase tracking-wider">Web Bluetooth</span>
                </button>
                <button
                  type="button"
                  onClick={() => pickPrinterType('usb')}
                  className={`flex flex-col items-center justify-center rounded-[12px] border p-4 text-center transition-all ${
                    printerType === 'usb' ? 'border-black bg-[#ededed] font-bold text-black ring-1 ring-black' : 'border-clay/60 bg-white text-stone hover:border-black'
                  }`}
                >
                  <span className="material-symbols-outlined mb-2 text-2xl">usb</span>
                  <span className="text-xs uppercase tracking-wider">Direct USB</span>
                </button>
                <button
                  type="button"
                  onClick={() => pickPrinterType('lan')}
                  className={`flex flex-col items-center justify-center rounded-[12px] border p-4 text-center transition-all ${
                    printerType === 'lan' ? 'border-black bg-[#ededed] font-bold text-black ring-1 ring-black' : 'border-clay/60 bg-white text-stone hover:border-black'
                  }`}
                >
                  <span className="material-symbols-outlined mb-2 text-2xl">lan</span>
                  <span className="text-xs uppercase tracking-wider">Network LAN</span>
                </button>
              </div>

              <div className="rounded-[12px] border border-sand bg-[#f9f9f9] p-5 space-y-4">
                {printerType === 'bluetooth' && (
                  <div>
                    <h3 className="font-semibold text-sm mb-1">Web Bluetooth Printer</h3>
                    {!isBluetoothSupported() ? (
                      <p className="text-xs text-[#ba1a1a] mb-4">Browser ini tidak mendukung Web Bluetooth — pakai Chrome/Edge (desktop/Android) via HTTPS atau localhost.</p>
                    ) : (
                      <p className="text-xs text-stone mb-4">Pindai printer struk Bluetooth di dekat kasir, lalu cetak pola tes untuk verifikasi.</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={handleConnectPrinter} disabled={printerBusy || !isBluetoothSupported()}>
                        <span>{printerBusy ? 'Menghubungkan…' : 'Pindai Device Bluetooth'}</span>
                      </Button>
                      <Button variant="outline" onClick={handlePrintTestPattern} disabled={printerBusy}>
                        <span>Cetak Pola Tes</span>
                      </Button>
                      <Button variant="outline" onClick={handleDisconnectPrinter} disabled={printerBusy}>
                        <span>Putuskan</span>
                      </Button>
                    </div>
                  </div>
                )}
                {printerType === 'usb' && (
                  <div>
                    <h3 className="font-semibold text-sm mb-1">Direct USB Printer</h3>
                    {!isUsbSupported() ? (
                      <p className="text-xs text-[#ba1a1a] mb-4">Browser ini tidak mendukung WebUSB — pakai Chrome/Edge desktop.</p>
                    ) : (
                      <p className="text-xs text-stone mb-4">Hubungkan printer via kabel USB, izinkan akses saat dialog browser muncul.</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={handleConnectPrinter} disabled={printerBusy || !isUsbSupported()}>
                        <span>{printerBusy ? 'Menghubungkan…' : 'Hubungkan Printer USB'}</span>
                      </Button>
                      <Button variant="outline" onClick={handlePrintTestPattern} disabled={printerBusy}>
                        <span>Cetak Pola Tes</span>
                      </Button>
                      <Button variant="outline" onClick={handleDisconnectPrinter} disabled={printerBusy}>
                        <span>Putuskan</span>
                      </Button>
                    </div>
                  </div>
                )}
                {printerType === 'lan' && (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm mb-1">Network LAN Printer</h3>
                    <p className="rounded-lg border border-[#9a6b2f]/40 bg-[#f9f9f9] px-3 py-2 text-xs text-black">
                      Mode simulasi — browser tidak bisa konek TCP langsung ke printer. Koneksi nyata via backend (proxy) menyusul; konfigurasi di bawah tersimpan per perangkat.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      <Field label="IP Address Printer">
                        <TextInput value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} placeholder="192.168.1.200" />
                      </Field>
                      <Field label="Port">
                        <TextInput value={port} onChange={(e) => setPort(e.target.value)} placeholder="9100" />
                      </Field>
                    </div>
                    <Button onClick={handleLanSimulatedTest} className="mt-2">
                      Simpan Konfigurasi (Simulasi)
                    </Button>
                  </div>
                )}
              </div>

              {printerError && (
                <p className="text-xs font-medium text-[#ba1a1a]">{printerError}</p>
              )}
              <div className="flex items-center justify-between rounded-lg border border-sand bg-white p-3 text-xs">
                <span className="text-stone">Status Printer:</span>
                <span className={`font-bold ${printerStatus.startsWith('Connected') || printerStatus.startsWith('Simulasi tersimpan') ? 'text-sage' : 'text-[#ba1a1a]'}`}>{printerStatus}</span>
              </div>
            </div>
          )}

          {activeCategory === 'cash' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-black">Modal Kas</h2>
                <p className="text-xs text-stone mt-1">Uang awal shift, perkiraan otomatis, dan uang closing.</p>
              </div>

              {cashSaved && (
                <div className="rounded-lg border border-sage/40 bg-[#b8cda9]/30 px-3 py-2 text-xs font-semibold text-sage">Modal kas tersimpan di server!</div>
              )}
              {cashError && (
                <div className="rounded-lg border border-[#ba1a1a]/30 bg-[#ba1a1a]/10 px-3 py-2 text-xs font-medium text-[#ba1a1a]">{cashError}</div>
              )}

              <Field label="Uang Awal Opening Cash (IDR)">
                <TextInput
                  type="number"
                  value={openingCashInput}
                  onChange={(e) => setOpeningCashInput(e.target.value)}
                  placeholder="0"
                  disabled={cashLoading}
                />
              </Field>
              <p className="text-[11px] text-stone">Menyimpan opening baru otomatis membuka shift baru (closing lama di-reset).</p>

              <div className="grid grid-cols-1 gap-3 rounded-[12px] border border-sand bg-cream p-4 text-sm md:grid-cols-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-stone">Opening</p>
                  <p className="font-bold text-black">{formatRupiah(business.openingCash ?? 0)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-stone">Cash Masuk (paid)</p>
                  <p className="font-bold text-black">{formatRupiah(cashPaidTotal)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-stone">Expected di Laci</p>
                  <p className="font-bold text-sage">{formatRupiah((business.openingCash ?? 0) + cashPaidTotal)}</p>
                </div>
              </div>

              <Field label="Uang Closing — cash fisik di laci (IDR)">
                <TextInput
                  type="number"
                  value={closingCashInput}
                  onChange={(e) => setClosingCashInput(e.target.value)}
                  placeholder="0"
                  disabled={cashLoading}
                />
              </Field>
              {closingPreview !== null && (
                <div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${closingPreview === 0 ? 'border-sage/40 bg-[#b8cda9]/30 text-sage' : closingPreview > 0 ? 'border-sage/40 bg-[#b8cda9]/30 text-sage' : 'border-[#ba1a1a]/30 bg-[#ba1a1a]/10 text-[#ba1a1a]'}`}>
                  Selisih vs expected: {closingPreview > 0 ? '+' : ''}{formatRupiah(closingPreview)}
                  {closingPreview === 0 ? ' — PAS' : closingPreview > 0 ? ' — LEBIH' : ' — KURANG'}
                </div>
              )}
              {business.closingCash !== null && business.closingCash !== undefined && (
                <p className="text-xs text-stone">
                  Shift ditutup: closing <span className="font-bold text-black">{formatRupiah(business.closingCash)}</span>
                  {business.cashClosedAt ? ` · ${new Date(business.cashClosedAt).toLocaleString('id-ID')}` : ''} ·
                  selisih <span className={`font-bold ${cashVariance !== null && cashVariance < 0 ? 'text-[#ba1a1a]' : 'text-sage'}`}>{cashVariance !== null ? formatRupiah(cashVariance) : '-'}</span>
                </p>
              )}
              <p className="text-[11px] text-stone">
                {cashLoading ? 'Memuat nilai dari server…' : 'Nilai tersimpan di server dan tetap ada setelah refresh.'}
              </p>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSaveCash} disabled={cashSaving || cashClosing || cashLoading} className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  <span>{cashSaving ? 'Menyimpan…' : 'Simpan Opening'}</span>
                </Button>
                <Button onClick={handleCloseShift} disabled={cashSaving || cashClosing || cashLoading} className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">lock</span>
                  <span>{cashClosing ? 'Menutup…' : 'Simpan & Tutup Shift'}</span>
                </Button>
                {business.closingCash !== null && business.closingCash !== undefined && (
                  <Button variant="outline" onClick={handleReopenShift} disabled={cashSaving || cashClosing || cashLoading} className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">lock_open</span>
                    <span>Buka Shift Lagi</span>
                  </Button>
                )}
              </div>
            </div>
          )}

          {activeCategory === 'account' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-black">Profil Pengguna</h2>
                <p className="text-xs text-stone mt-1">Informasi sesi kasir yang sedang aktif saat ini.</p>
              </div>

              <div className="flex items-start justify-between rounded-[12px] border border-sand bg-cream p-5">
                <div className="flex items-center gap-4">
                  <div className="flex size-14 items-center justify-center rounded-full bg-black font-bold text-xl text-white">
                    {session?.user.name.charAt(0) || 'K'}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-black">{session?.user.name || 'Kasir Cafe'}</h3>
                    <p className="text-xs text-stone">{session?.user.email || 'kasir@cafe.com'}</p>
                    <span className="mt-2 inline-block rounded-full bg-sand px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">
                      Role: {session?.user.role || 'Staff'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 border-t border-sand pt-4 text-xs">
                <div className="flex justify-between py-1">
                  <span className="text-stone">Nama Cafe:</span>
                  <span className="font-semibold text-black">{business.name}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-stone">Alamat:</span>
                  <span className="font-semibold text-black">{business.address}</span>
                </div>
              </div>

              <div className="border-t border-sand pt-6">
                <button
                  type="button"
                  onClick={logout}
                  className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#ba1a1a] py-3 text-sm font-semibold text-white hover:bg-[#ba1a1a]/90 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span>
                  <span>Keluar / Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
