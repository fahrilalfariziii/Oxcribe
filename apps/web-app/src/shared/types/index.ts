export type UserRole = 'owner' | 'kasir' | 'barista'

export type OrderStatus = 'diterima' | 'diproses' | 'siap' | 'selesai' | 'batal'
export type PaymentMethod = 'cash' | 'qris' | 'bank_transfer'
export type PaymentStatus = 'pending' | 'paid' | 'failed'

export interface PaymentSettings {
  instruction?: string
  qrImageUrl?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
  gateway?: 'manual' | 'midtrans' | 'doku'
  acquirer?: string
  bank?: 'bca' | 'mandiri' | 'bni' | 'bri'
  allowedBanks?: ('bca' | 'mandiri' | 'bni' | 'bri')[]
}
export type OrderSource = 'self_order' | 'pos'
export type ConnectionStatus = 'online' | 'offline' | 'syncing'
export type StockMovementType = 'in' | 'out' | 'adjustment' | 'waste'
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed'

export type TaxLabel = 'PB1' | 'PBJT' | 'PPN'
export type TaxBearer = 'customer' | 'cafe'

export interface BusinessTheme {
  primary: string
  accent: string
  pageBg?: string
  headerImage?: string
  headerOverlay?: number
  welcomeText?: string
  showTagline?: boolean
  titleFont?: 'display' | 'sans' | 'serif'
  radius?: 'rounded' | 'full'
}

export const DEFAULT_THEME: Required<BusinessTheme> = {
  primary: '#2f3e2a',
  accent: '#4a7c59',
  pageBg: '#f7f3ea',
  headerImage: '',
  headerOverlay: 50,
  welcomeText: 'Halo, Selamat Datang!',
  showTagline: true,
  titleFont: 'display',
  radius: 'full',
}

export const THEME_PRESETS: { id: string; label: string; emoji: string; theme: BusinessTheme }[] = [
  { id: 'forest', label: 'Forest', emoji: '🌲', theme: { ...DEFAULT_THEME } },
  { id: 'terracotta', label: 'Terracotta', emoji: '🧱', theme: { ...DEFAULT_THEME, primary: '#9a3f2c', accent: '#c46a4a', pageBg: '#faf3ec' } },
  { id: 'ocean', label: 'Ocean', emoji: '🌊', theme: { ...DEFAULT_THEME, primary: '#1e4e5f', accent: '#3a8fa8', pageBg: '#eef4f6' } },
  { id: 'mono', label: 'Mono', emoji: '⬛', theme: { ...DEFAULT_THEME, primary: '#1c1917', accent: '#57534e', pageBg: '#f5f5f4' } },
  { id: 'cream', label: 'Cream', emoji: '☕', theme: { ...DEFAULT_THEME, primary: '#6b4f2e', accent: '#a98a5b', pageBg: '#faf6ee' } },
]

/** Normalisasi tema parsial/rusak dari server -> selalu lengkap & aman dirender. */
export function normalizeTheme(raw: unknown): Required<BusinessTheme> {
  const t = (raw ?? {}) as Partial<BusinessTheme>
  const hex = (v: unknown, fb: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fb)
  const num = (v: unknown, fb: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb
  return {
    primary: hex(t.primary, DEFAULT_THEME.primary),
    accent: hex(t.accent, DEFAULT_THEME.accent),
    pageBg: typeof t.pageBg === 'string' && t.pageBg ? t.pageBg : DEFAULT_THEME.pageBg,
    headerImage: typeof t.headerImage === 'string' ? t.headerImage : '',
    headerOverlay: num(t.headerOverlay, DEFAULT_THEME.headerOverlay, 0, 80),
    welcomeText: typeof t.welcomeText === 'string' && t.welcomeText.trim() ? t.welcomeText : DEFAULT_THEME.welcomeText,
    showTagline: typeof t.showTagline === 'boolean' ? t.showTagline : true,
    titleFont: t.titleFont === 'sans' || t.titleFont === 'serif' || t.titleFont === 'display' ? t.titleFont : 'display',
    radius: t.radius === 'rounded' ? 'rounded' : 'full',
  }
}
export interface Business {
  id: string
  name: string
  tagline: string
  address: string
  phone: string
  email: string
  logoUrl?: string
  taxEnabled: boolean
  taxLabel: TaxLabel
  taxRate: number
  taxBearer: TaxBearer
  serviceChargeEnabled: boolean
  serviceChargeRate: number
  // Service charge independen dari pajak: percent (% subtotal) / flat (Rp per transaksi).
  serviceChargeMode: 'percent' | 'flat'
  serviceChargeFlat: number
  // Platform fee self-order non-tunai (per kafe, diatur Platform Admin).
  // Harga menu diasumsikan sudah include pajak/service -> basis fee = subtotal.
  platformFeeEnabled: boolean
  platformFeeMode: 'percent' | 'flat'
  platformFeePercent: number
  platformFeeFlat: number
  platformFeeBearer: TaxBearer // 'customer' = di atas total | 'cafe' = ditanggung kafe
  // Flag fitur efektif dari backend (plans + overrides).
  // serviceCharge/taxFees=false (default) = section tsb dikunci & komponen NOL di total.
  features?: { serviceCharge?: boolean; taxFees?: boolean; taxAndFees?: boolean } & Record<string, boolean | undefined>
  soundEnabled: boolean
  openingCash: number
  closingCash: number | null
  cashClosedAt?: string | null
  qrTemplate?: QrConfig
  theme?: BusinessTheme
  enabledPaymentMethods: PaymentMethod[]
  paymentSettings: Record<string, PaymentSettings>
  dokuMode?: 'global'
  dokuConfigured?: boolean
}

export interface StaffUser {
  id: string
  name: string
  email: string
  role: UserRole
  active: boolean
  password: string
}

export interface QrConfig {
  title?: string
  subtitle?: string
  instruction?: string
  extraText?: string
  showLogo: boolean
  showTableNumber: boolean
  accentColor?: string
}

export interface CafeTable {
  id: string
  tableNumber: string
  qrToken: string
  isActive: boolean
  area?: string
  qrConfig?: QrConfig
}

export interface Category {
  id: string
  name: string
  sortOrder: number
}

export interface ProductOption {
  id: string
  name: string
  type: string
  price: number
  isRequired: boolean
}

export interface Product {
  id: string
  categoryId: string
  name: string
  description: string
  price: number
  hpp?: number
  imageUrl: string
  isAvailable: boolean
  badge?: string
  options: ProductOption[]
}

export interface CartItem {
  cartId: string
  productId: string
  name: string
  price: number
  quantity: number
  optionsLabel: string
  options: Record<string, string | number | boolean>
  imageUrl: string
}

export interface OrderItem {
  id: string
  productId: string
  productName: string
  price: number
  quantity: number
  options: Record<string, string | number | boolean>
  optionsLabel: string
  subtotal: number
}

export interface Order {
  id: string
  orderNumber: string
  clientOrderId: string
  tableId: string | null
  tableNumber: string | null
  customerName: string
  source: OrderSource
  status: OrderStatus
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  subtotal: number
  serviceCharge: number
  tax: number
  taxLabel: TaxLabel
  taxBearer: TaxBearer
  // Snapshot platform fee + estimasi MDR (0 untuk cash & manual order).
  platformFee: number
  platformFeeBearer: TaxBearer
  mdrFee: number
  total: number
  createdAt: string
  items: OrderItem[]
  syncStatus: SyncStatus
}

export interface Ingredient {
  id: string
  name: string
  unit: string
  currentStock: number
  minimumStock: number
  isAvailable: boolean
}

export interface StockMovement {
  id: string
  ingredientId: string
  type: StockMovementType
  quantity: number
  stockBefore: number
  stockAfter: number
  notes: string
  createdAt: string
  // Penerimaan supplier (type "in")
  supplier?: string | null
  referenceNo?: string | null
  unitCost?: number | null
  batchNo?: string | null
  expiryDate?: string | null
  // Penyesuaian (type "adjustment"): waste_damage | variance_missing | internal_promo | correction
  reason?: string | null
}

export const ADJUSTMENT_REASONS: { id: string; label: string }[] = [
  { id: 'waste_damage', label: 'Waste / Rusak (basi, busuk, cacat)' },
  { id: 'variance_missing', label: 'Selisih / Hilang (opname, tercecer)' },
  { id: 'internal_promo', label: 'Internal / Promo (testing, sampel)' },
  { id: 'correction', label: 'Koreksi (salah catat sebelumnya)' },
]
