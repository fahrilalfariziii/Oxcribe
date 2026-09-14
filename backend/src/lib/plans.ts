// Definisi paket berlangganan SaaS (sumber tunggal).
//
// Tahap scaffold: data statis di kode agar Landing Page bisa render tabel harga
// via GET /api/public/plans tanpa migrasi DB. Saat tahap Full SaaS, pindahkan
// ke tabel `plans` (lihat docs/prd_SaaS_multitenant.md §7) dengan bentuk yang sama.
export type PlanCode = "starter" | "pro" | "enterprise";

export interface PlanDefinition {
  id: number;
  code: PlanCode;
  name: string;
  price: number;
  billingCycle: "monthly" | "custom";
  featureFlags: Record<string, boolean>;
  limits: Record<string, number | null>;
}

export const PLANS: PlanDefinition[] = [
  {
    id: 1,
    code: "starter",
    name: "Starter",
    price: 99000,
    billingCycle: "monthly",
    featureFlags: {
      posManual: true,
      receiptBasic: true,
      dashboardSimple: true,
      salesSummary: true,
      staffLimited: true,
      taxBasic: true,
      taxAndFees: false,
      selfOrder: false,
      tableManagement: false,
      inventory: false,
      offlineSync: false,
      analyticsFull: false,
      salesType: false,
      performanceItem: false,
      exportCsv: false,
      themePreset: false,
      themeCustom: false,
      customDomain: false,
      multiOutlet: false,
      apiAccess: false,
    },
    limits: { maxTables: 0, maxStaff: 3 },
  },
  {
    id: 2,
    code: "pro",
    name: "Pro",
    price: 249000,
    billingCycle: "monthly",
    featureFlags: {
      posManual: true,
      receiptBasic: true,
      dashboardSimple: true,
      salesSummary: true,
      staffLimited: false,
      taxBasic: false,
      taxFull: true,
      taxAndFees: false,
      selfOrder: true,
      tableManagement: true,
      inventory: true,
      offlineSync: true,
      analyticsFull: true,
      salesType: true,
      performanceItem: true,
      exportCsv: true,
      themePreset: true,
      themeCustom: false,
      customDomain: false,
      multiOutlet: false,
      apiAccess: false,
    },
    limits: { maxTables: 30, maxStaff: null },
  },
  {
    id: 3,
    code: "enterprise",
    name: "Enterprise",
    price: 0,
    billingCycle: "custom",
    featureFlags: {
      posManual: true,
      receiptBasic: true,
      dashboardSimple: true,
      salesSummary: true,
      staffLimited: false,
      taxFull: true,
      taxAndFees: false,
      selfOrder: true,
      tableManagement: true,
      inventory: true,
      offlineSync: true,
      analyticsFull: true,
      salesType: true,
      performanceItem: true,
      exportCsv: true,
      themePreset: true,
      themeCustom: true,
      customDomain: true,
      multiOutlet: true,
      apiAccess: true,
    },
    limits: { maxTables: null, maxStaff: null },
  },
];

export function getPlanByCode(code: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.code === code);
}
