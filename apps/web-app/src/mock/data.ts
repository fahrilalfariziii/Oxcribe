import type {
  Business,
  CafeTable,
  Category,
  Ingredient,
  Order,
  Product,
  StaffUser,
  StockMovement,
} from '../shared/types'

export const IMG = {
  headerBg:
    'https://images.unsplash.com/photo-1485686531765-ba63b07845a7?crop=entropy&cs=tinysrgb&fit=crop&w=800&h=400&q=80',
  caramelMacchiato:
    'https://images.unsplash.com/photo-1604298458655-ae6e04213678?crop=entropy&cs=tinysrgb&fit=crop&w=400&h=400&q=80',
  doubleEspresso:
    'https://images.unsplash.com/photo-1580661869408-55ab23f2ca6e?crop=entropy&cs=tinysrgb&fit=crop&w=400&h=400&q=80',
  butterCroissant:
    'https://images.unsplash.com/photo-1681218424681-b4f8228ecea9?crop=entropy&cs=tinysrgb&fit=crop&w=400&h=400&q=80',
  matchaLatte:
    'https://images.unsplash.com/photo-1749280447307-31a68eb38673?crop=entropy&cs=tinysrgb&fit=crop&w=400&h=400&q=80',
  icedCaramelLatte:
    'https://images.unsplash.com/photo-1662047102608-a6f2e492411f?crop=entropy&cs=tinysrgb&fit=crop&w=400&h=400&q=80',
  flatWhite:
    'https://images.unsplash.com/photo-1732030564789-bb6f12144091?q=80&w=1374&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  almondCroissant:
    'https://images.unsplash.com/photo-1623334044303-241021148842?crop=entropy&cs=tinysrgb&fit=crop&w=400&h=400&q=80',
}

const drinkOptions: Product['options'] = [
  { id: 't-hot', name: 'Hot', type: 'temperature', price: 0, isRequired: true },
  { id: 't-iced', name: 'Iced', type: 'temperature', price: 0, isRequired: true },
  { id: 's-normal', name: 'Normal', type: 'sugar', price: 0, isRequired: true },
  { id: 's-less', name: 'Less Sugar', type: 'sugar', price: 0, isRequired: true },
  { id: 's-no', name: 'No Sugar', type: 'sugar', price: 0, isRequired: true },
  { id: 'i-normal', name: 'Normal', type: 'ice', price: 0, isRequired: true },
  { id: 'i-less', name: 'Less Ice', type: 'ice', price: 0, isRequired: true },
  { id: 'i-no', name: 'No Ice', type: 'ice', price: 0, isRequired: true },
  { id: 'm-reg', name: 'Regular', type: 'milk', price: 0, isRequired: false },
  { id: 'm-oat', name: 'Oat', type: 'milk', price: 5000, isRequired: false },
  { id: 'm-soy', name: 'Soy', type: 'milk', price: 3000, isRequired: false },
  { id: 'a-shot', name: 'Extra Espresso', type: 'addon', price: 5000, isRequired: false },
  { id: 'a-vanilla', name: 'Vanilla Syrup', type: 'addon', price: 5000, isRequired: false },
]

export const seedBusiness: Business = {
  id: 'biz-1',
  name: 'Bean & Brew',
  tagline: 'Eksplorasi Rasa dalam Setiap Cangkir',
  address: 'Jl. Senopati No. 12, Jakarta Selatan',
  phone: '021-555-0192',
  email: 'hello@beanbrew.id',
  logoUrl: undefined,
  taxEnabled: false,
  taxLabel: 'PB1',
  taxRate: 0,
  taxBearer: 'customer',
  serviceChargeEnabled: false,
  serviceChargeRate: 0,
  serviceChargeMode: 'percent',
  serviceChargeFlat: 0,
  platformFeeEnabled: false,
  platformFeeMode: 'percent',
  platformFeePercent: 0,
  platformFeeFlat: 0,
  platformFeeBearer: 'customer',
  features: { taxAndFees: false, serviceCharge: false, taxFees: false },
  soundEnabled: true,
  openingCash: 0,
  closingCash: null,
  cashClosedAt: null,
  enabledPaymentMethods: ['cash', 'qris', 'bank_transfer'],
  paymentSettings: {
    cash: { gateway: 'manual' },
    qris: { gateway: 'doku' },
    bank_transfer: { gateway: 'doku', bank: 'bca', allowedBanks: ['bca', 'mandiri', 'bni', 'bri'] },
  },
  dokuMode: 'global',
  dokuConfigured: false,
}

export const seedStaff: StaffUser[] = [
  { id: 'u-1', name: 'Amira Owner', email: 'owner@beanbrew.id', role: 'owner', active: true, password: 'Owner123!' },
  { id: 'u-2', name: 'Raka Kasir', email: 'kasir@beanbrew.id', role: 'kasir', active: true, password: 'Kasir123!' },
  { id: 'u-3', name: 'Sinta Barista', email: 'barista@beanbrew.id', role: 'barista', active: true, password: 'Barista123!' },
]

export const seedCategories: Category[] = [
  { id: 'c-sig', name: 'Signature', sortOrder: 1 },
  { id: 'c-esp', name: 'Espresso', sortOrder: 2 },
  { id: 'c-non', name: 'Non-Coffee', sortOrder: 3 },
  { id: 'c-pas', name: 'Pastry', sortOrder: 4 },
]

export const seedProducts: Product[] = [
  {
    id: 'p-1',
    categoryId: 'c-sig',
    name: 'Caramel Macchiato',
    description: 'Espresso dengan sirup vanilla, susu segar, dan karamel.',
    price: 45000,
    imageUrl: IMG.caramelMacchiato,
    isAvailable: true,
    badge: 'SIGNATURE',
    options: drinkOptions,
  },
  {
    id: 'p-2',
    categoryId: 'c-esp',
    name: 'Double Espresso',
    description: 'Dua shot espresso murni dari biji kopi house blend.',
    price: 30000,
    imageUrl: IMG.doubleEspresso,
    isAvailable: true,
    options: drinkOptions.filter((o) => o.type === 'temperature' || o.type === 'addon'),
  },
  {
    id: 'p-3',
    categoryId: 'c-pas',
    name: 'Butter Croissant',
    description: 'Croissant klasik ala Perancis yang renyah di luar.',
    price: 25000,
    imageUrl: IMG.butterCroissant,
    isAvailable: false,
    options: [],
  },
  {
    id: 'p-4',
    categoryId: 'c-non',
    name: 'Matcha Latte',
    description: 'Bubuk matcha premium Jepang yang diseduh dengan sempurna.',
    price: 40000,
    imageUrl: IMG.matchaLatte,
    isAvailable: true,
    options: drinkOptions,
  },
  {
    id: 'p-5',
    categoryId: 'c-sig',
    name: 'Iced Caramel Latte',
    description: 'Espresso dengan sirup karamel dan susu oat segar.',
    price: 45000,
    imageUrl: IMG.icedCaramelLatte,
    isAvailable: true,
    badge: 'SIGNATURE',
    options: drinkOptions,
  },
  {
    id: 'p-6',
    categoryId: 'c-esp',
    name: 'Flat White',
    description: 'Double ristretto dengan microfoam susu yang lembut.',
    price: 38000,
    imageUrl: IMG.flatWhite,
    isAvailable: true,
    options: drinkOptions,
  },
  {
    id: 'p-7',
    categoryId: 'c-pas',
    name: 'Almond Croissant',
    description: 'Croissant isi krim almond dengan taburan kacang.',
    price: 32000,
    imageUrl: IMG.almondCroissant,
    isAvailable: true,
    options: [],
  },
]

export const seedTables: CafeTable[] = [
  { id: 't-1', tableNumber: '01', qrToken: 'table-01', isActive: true },
  { id: 't-2', tableNumber: '02', qrToken: 'table-02', isActive: true },
  { id: 't-3', tableNumber: '03', qrToken: 'table-03', isActive: true },
  { id: 't-4', tableNumber: '04', qrToken: 'table-04', isActive: true },
  { id: 't-5', tableNumber: '05', qrToken: 'table-05', isActive: true },
  { id: 't-6', tableNumber: '06', qrToken: 'table-06', isActive: false },
]

export const seedIngredients: Ingredient[] = [
  { id: 'i-1', name: 'Espresso Beans (House)', unit: 'kg', currentStock: 12.4, minimumStock: 4, isAvailable: true },
  { id: 'i-2', name: 'Oat Milk', unit: 'L', currentStock: 3.2, minimumStock: 5, isAvailable: true },
  { id: 'i-3', name: 'Vanilla Syrup', unit: 'botol', currentStock: 6, minimumStock: 2, isAvailable: true },
  { id: 'i-4', name: 'Croissants', unit: 'pcs', currentStock: 0, minimumStock: 8, isAvailable: false },
  { id: 'i-5', name: 'Susu Fresh', unit: 'L', currentStock: 18, minimumStock: 8, isAvailable: true },
]

export const seedMovements: StockMovement[] = [
  {
    id: 'm-1',
    ingredientId: 'i-1',
    type: 'in',
    quantity: 5,
    stockBefore: 7.4,
    stockAfter: 12.4,
    notes: 'Restock mingguan',
    createdAt: new Date().toISOString(),
  },
]

function minutesAgo(min: number) {
  return new Date(Date.now() - min * 60_000).toISOString()
}

export const seedOrders: Order[] = [
  {
    id: 'o-1',
    orderNumber: 'BB-9021',
    clientOrderId: 'cli-o-1',
    tableId: 't-4',
    tableNumber: '04',
    customerName: 'Dina',
    source: 'self_order',
    status: 'diproses',
    paymentMethod: 'qris',
    paymentStatus: 'paid',
    subtotal: 90000,
    serviceCharge: 4500,
    tax: 9450,
    taxLabel: 'PB1',
    taxBearer: 'customer',
    platformFee: 4500,
    platformFeeBearer: 'customer',
    mdrFee: 759,
    total: 108450,
    createdAt: minutesAgo(12),
    syncStatus: 'synced',
    items: [
      {
        id: 'oi-1',
        productId: 'p-1',
        productName: 'Caramel Macchiato',
        price: 45000,
        quantity: 1,
        options: { temperature: 'Iced', sugar: 'Less Sugar' },
        optionsLabel: 'Iced, Less Sugar',
        subtotal: 45000,
      },
      {
        id: 'oi-2',
        productId: 'p-4',
        productName: 'Matcha Latte',
        price: 45000,
        quantity: 1,
        options: { milk: 'Oat' },
        optionsLabel: 'Oat Milk',
        subtotal: 45000,
      },
    ],
  },
  {
    id: 'o-2',
    orderNumber: 'BB-9022',
    clientOrderId: 'cli-o-2',
    tableId: 't-2',
    tableNumber: '02',
    customerName: 'Andi',
    source: 'self_order',
    status: 'diterima',
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    subtotal: 30000,
    serviceCharge: 1500,
    tax: 3150,
    taxLabel: 'PB1',
    taxBearer: 'customer',
    platformFee: 0,
    platformFeeBearer: 'customer',
    mdrFee: 0,
    total: 34650,
    createdAt: minutesAgo(4),
    syncStatus: 'synced',
    items: [
      {
        id: 'oi-3',
        productId: 'p-2',
        productName: 'Double Espresso',
        price: 30000,
        quantity: 1,
        options: { temperature: 'Hot' },
        optionsLabel: 'Hot',
        subtotal: 30000,
      },
    ],
  },
  {
    id: 'o-3',
    orderNumber: 'BB-9020',
    clientOrderId: 'cli-o-3',
    tableId: null,
    tableNumber: 'Kasir',
    customerName: 'Walk-in',
    source: 'pos',
    status: 'siap',
    paymentMethod: 'bank_transfer',
    paymentStatus: 'paid',
    subtotal: 70000,
    serviceCharge: 3500,
    tax: 7350,
    taxLabel: 'PB1',
    taxBearer: 'customer',
    platformFee: 0,
    platformFeeBearer: 'customer',
    mdrFee: 4440,
    total: 80850,
    createdAt: minutesAgo(28),
    syncStatus: 'synced',
    items: [
      {
        id: 'oi-4',
        productId: 'p-6',
        productName: 'Flat White',
        price: 38000,
        quantity: 1,
        options: { milk: 'Oat' },
        optionsLabel: 'Oat Milk',
        subtotal: 38000,
      },
      {
        id: 'oi-5',
        productId: 'p-7',
        productName: 'Almond Croissant',
        price: 32000,
        quantity: 1,
        options: {},
        optionsLabel: '',
        subtotal: 32000,
      },
    ],
  },
]

export const TAX_PER_TRANSACTION = 0
