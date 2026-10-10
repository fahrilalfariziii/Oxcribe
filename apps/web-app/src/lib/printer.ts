// Koneksi printer thermal ESC/POS generik 58mm dari browser kasir.
// - Bluetooth: Web Bluetooth API (Chrome/Edge desktop & Android).
// - USB: WebUSB API (Chrome/Edge desktop).
// - LAN: TIDAK BISA dari browser (tanpa raw TCP) — simulasi tersimpan, proxy backend menyusul.
// Config tersimpan per perangkat di localStorage (bukan data bisnis).

export type PrinterType = 'bluetooth' | 'usb' | 'lan'

export interface PrinterConfig {
  type: PrinterType
  deviceName?: string
  ip?: string
  port?: string
}

const PRINTER_CONFIG_KEY = 'servopay_printer_config'

export function loadPrinterConfig(): PrinterConfig {
  try {
    const raw = localStorage.getItem(PRINTER_CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PrinterConfig>
      return {
        type: parsed.type === 'usb' || parsed.type === 'lan' ? parsed.type : 'bluetooth',
        deviceName: parsed.deviceName,
        ip: parsed.ip ?? '192.168.1.200',
        port: parsed.port ?? '9100',
      }
    }
  } catch {}
  return { type: 'bluetooth', ip: '192.168.1.200', port: '9100' }
}

export function savePrinterConfig(cfg: PrinterConfig): void {
  try {
    localStorage.setItem(PRINTER_CONFIG_KEY, JSON.stringify(cfg))
  } catch {}
}

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export function isUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

// ---------- ESC/POS builder (58mm, 32 kolom, generik) ----------

const ESC = 0x1b
const GS = 0x1d
const COLS = 32

function ascii(s: string): number[] {
  // Printer generik: transliterasi ke Latin dasar agar tidak jadi byte rusak
  const clean = s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
  return [...new TextEncoder().encode(clean)]
}

function line(text = ''): number[] {
  return [...ascii(text.slice(0, COLS)), 0x0a]
}

function row(left: string, right: string): number[] {
  const r = right.slice(-12)
  const l = left.slice(0, COLS - r.length - 1)
  return line(`${l}${' '.repeat(COLS - l.length - r.length)}${r}`)
}

function divider(ch = '-'): number[] {
  return line(ch.repeat(COLS))
}

export interface ReceiptData {
  businessName: string
  address?: string
  phone?: string
  orderNumber: string
  date: string
  customer: string
  table: string
  items: { name: string; qty: number; price: number; subtotal: number; optionsLabel?: string }[]
  subtotal: number
  serviceCharge: number
  taxLabel: string
  tax: number
  total: number
  paymentMethod: string
  money: (n: number) => string
}

export function buildReceiptBytes(r: ReceiptData): Uint8Array {
  const b: number[] = []
  b.push(ESC, 0x40) // init
  b.push(ESC, 0x61, 0x01) // center
  b.push(GS, 0x21, 0x11) // double size
  b.push(...line(r.businessName.toUpperCase()))
  b.push(GS, 0x21, 0x00) // normal
  if (r.address) b.push(...line(r.address))
  if (r.phone) b.push(...line(`Telp: ${r.phone}`))
  b.push(...divider('='))
  b.push(ESC, 0x61, 0x00) // left
  b.push(...row('No:', `#${r.orderNumber}`))
  b.push(...row('Tgl:', r.date))
  b.push(...row('Pelanggan:', r.customer))
  b.push(...row('Meja:', r.table))
  b.push(...divider())
  for (const it of r.items) {
    b.push(...line(`${it.qty}x ${it.name}`.slice(0, COLS)))
    if (it.optionsLabel) b.push(...line(`  (${it.optionsLabel})`.slice(0, COLS)))
    b.push(...row(`  @${r.money(it.price)}`, r.money(it.subtotal)))
  }
  b.push(...divider())
  b.push(...row('Subtotal', r.money(r.subtotal)))
  if (r.serviceCharge > 0) b.push(...row('Service', r.money(r.serviceCharge)))
  b.push(...row(`Pajak (${r.taxLabel})`, r.money(r.tax)))
  b.push(ESC, 0x45, 0x01) // bold on
  b.push(...row('TOTAL', r.money(r.total)))
  b.push(ESC, 0x45, 0x00) // bold off
  b.push(...row('Bayar', r.paymentMethod.toUpperCase()))
  b.push(...divider('='))
  b.push(ESC, 0x61, 0x01)
  b.push(...line('Terima kasih!'))
  b.push(...line(''))
  b.push(...line(''))
  b.push(GS, 0x56, 0x00) // cut
  return new Uint8Array(b)
}

/** Halaman uji: garis, teks besar, pola potong — untuk verifikasi printer fisik. */
export function buildTestPatternBytes(): Uint8Array {
  const b: number[] = []
  b.push(ESC, 0x40)
  b.push(ESC, 0x61, 0x01)
  b.push(GS, 0x21, 0x11)
  b.push(...line('TEST PRINTER'))
  b.push(GS, 0x21, 0x00)
  b.push(...line('Oxcribe POS'))
  b.push(...divider('='))
  b.push(...line('12345678901234567890123456789012'))
  b.push(...row('Kiri', 'Kanan'))
  b.push(ESC, 0x45, 0x01)
  b.push(...line('TEBAL OK'))
  b.push(ESC, 0x45, 0x00)
  b.push(...divider())
  b.push(...line('Jika terbaca rapi,'))
  b.push(...line('printer siap dipakai.'))
  b.push(...line(''))
  b.push(...line(''))
  b.push(GS, 0x56, 0x00)
  return new Uint8Array(b)
}

// ---------- Web Bluetooth ----------

// Service umum printer thermal BLE (privat 0xFF00 dipakai mayoritas XPrinter dkk.)
const PRINTER_SERVICE_UUIDS = [
  '0000ff00-0000-1000-8000-00805f9a34fb',
  '000018f0-0000-1000-8000-00805f9a34fb',
  '0000fff0-0000-1000-8000-00805f9a34fb',
]

interface BleSession {
  device: { name?: string | null; gatt?: { connected: boolean; disconnect(): void } | null }
  characteristic: { writeValue(data: BufferSource): Promise<void> }
}

let ble: BleSession | null = null

async function findWritableCharacteristic(server: {
  getPrimaryServices(): Promise<{ getCharacteristics(): Promise<{ properties: { write?: boolean; writeWithoutResponse?: boolean }; writeValue(d: BufferSource): Promise<void> }[]> }[]>
}): Promise<{ writeValue(data: BufferSource): Promise<void> } | null> {
  const services = await server.getPrimaryServices()
  for (const svc of services) {
    const chars = await svc.getCharacteristics()
    for (const c of chars) {
      if (c.properties.write || c.properties.writeWithoutResponse) return c
    }
  }
  return null
}

export async function connectBluetoothPrinter(): Promise<string> {
  const nav = navigator as unknown as {
    bluetooth?: { requestDevice(o: Record<string, unknown>): Promise<never> }
  }
  if (!nav.bluetooth) throw new Error('Browser tidak mendukung Web Bluetooth (pakai Chrome/Edge).')
  const device = (await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICE_UUIDS,
  })) as unknown as {
    name?: string | null
    gatt?: { connect(): Promise<never>; connected: boolean; disconnect(): void }
  }
  if (!device.gatt) throw new Error('Perangkat tidak punya GATT.')
  const server = (await device.gatt.connect()) as unknown as Parameters<typeof findWritableCharacteristic>[0]
  const char = await findWritableCharacteristic(server)
  if (!char) throw new Error('Characteristic tulis tidak ditemukan di printer ini.')
  ble = { device, characteristic: char }
  return device.name ?? 'Printer Bluetooth'
}

export function isBluetoothConnected(): boolean {
  return !!ble && !!ble.device.gatt?.connected
}

export function disconnectBluetoothPrinter(): void {
  try {
    ble?.device.gatt?.disconnect()
  } catch {}
  ble = null
}

export async function printViaBluetooth(data: Uint8Array): Promise<void> {
  if (!ble) throw new Error('Belum terhubung — pindai dulu.')
  // BLE MTU kecil: kirim per chunk 128 byte
  for (let i = 0; i < data.length; i += 128) {
    await ble.characteristic.writeValue(data.slice(i, i + 128) as unknown as BufferSource)
  }
}

// ---------- WebUSB ----------

let usbDevice: {
  open(): Promise<void>
  claimInterface(n: number): Promise<void>
  transferOut(ep: number, data: BufferSource): Promise<unknown>
  close(): Promise<void>
  productName?: string
} | null = null

export async function connectUsbPrinter(): Promise<string> {
  const nav = navigator as unknown as {
    usb?: { requestDevice(o: Record<string, unknown>): Promise<never> }
  }
  if (!nav.usb) throw new Error('Browser tidak mendukung WebUSB (pakai Chrome/Edge desktop).')
  const dev = (await nav.usb.requestDevice({ filters: [{}] })) as unknown as typeof usbDevice & {
    configuration?: unknown
    selectConfiguration(n: number): Promise<void>
  }
  if (!dev) throw new Error('Tidak ada device dipilih.')
  await dev.open()
  try {
    if (dev.configuration === undefined || dev.configuration === null) await dev.selectConfiguration(1)
  } catch {}
  // Mayoritas printer ESC/POS USB pakai interface 0, endpoint OUT 1
  await dev.claimInterface(0)
  usbDevice = dev
  return dev.productName ?? 'Printer USB'
}

export function isUsbConnected(): boolean {
  return usbDevice !== null
}

export async function disconnectUsbPrinter(): Promise<void> {
  try {
    await usbDevice?.close()
  } catch {}
  usbDevice = null
}

export async function printViaUsb(data: Uint8Array): Promise<void> {
  if (!usbDevice) throw new Error('Belum terhubung — hubungkan dulu.')
  for (let i = 0; i < data.length; i += 64) {
    await usbDevice.transferOut(1, data.slice(i, i + 64) as unknown as BufferSource)
  }
}
