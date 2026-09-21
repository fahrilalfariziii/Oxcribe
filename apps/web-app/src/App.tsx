import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CafeProvider, useCafe } from "./mock/store";
import { isFeatureOn, canUseTheme } from "./shared/lib/features";
import { LoginPage } from "./features/auth/LoginPage";
import { ForgotPasswordPage } from "./features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./features/auth/ResetPasswordPage";
import { RequireAuth } from "./features/auth/RequireAuth";
import { SelfOrderApp } from "./features/self-order/SelfOrderApp";
import { PosLayout } from "./features/pos/PosLayout";
import { OrdersPage } from "./features/pos/pages/OrdersPage";
import { CatalogPage } from "./features/pos/pages/CatalogPage";
import { InventoryPage } from "./features/pos/pages/InventoryPage";
import { ManualOrderPage } from "./features/pos/pages/ManualOrderPage";
import { PosSettingsPage } from "./features/pos/pages/PosSettingsPage";
import { OwnerLayout } from "./features/owner/OwnerLayout";
import { DashboardPage } from "./features/owner/pages/DashboardPage";
import { SalesOmsetPage } from "./features/owner/pages/sales/SalesOmsetPage";
import { SalesPerformancePage } from "./features/owner/pages/sales/SalesPerformancePage";
import { SalesHistoryPage } from "./features/owner/pages/sales/SalesHistoryPage";
import { MenuCatalogPage } from "./features/owner/pages/menu/MenuCatalogPage";
import { MenuCategoriesPage } from "./features/owner/pages/menu/MenuCategoriesPage";
import { MenuVariantsPage } from "./features/owner/pages/menu/MenuVariantsPage";
import { TablesPage } from "./features/owner/pages/TablesPage";
import { StaffPage } from "./features/owner/pages/StaffPage";
import { OwnerSettingsPage } from "./features/owner/OwnerLayout";
import { ProfileSettingsPage } from "./features/owner/pages/settings/ProfileSettingsPage";
import { CafeSettingsPage } from "./features/owner/pages/settings/CafeSettingsPage";
import { TaxSettingsPage } from "./features/owner/pages/settings/TaxSettingsPage";
import { PaymentSettingsPage } from "./features/owner/pages/settings/PaymentSettingsPage";

function RootRedirect() {
  const { session } = useCafe();
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.role === "owner") return <Navigate to="/backoffice/dashboard" replace />;
  return <Navigate to="/frontoffice/orders" replace />;
}

// Guard fitur generik (padanan component-mode dari throw redirect() di docs
// React Router — Context7 /remix-run/react-router): direct URL di-redirect
// bila flag OFF. serviceCharge/taxFees fail-closed; flag lain fail-open bila key hilang.
function RequireFeature({ flag, fallback, children }: { flag: string | string[]; fallback: string; children: React.ReactNode }) {
  const { business } = useCafe();
  const flags = Array.isArray(flag) ? flag : [flag];
  // Tema spesial: lolos bila preset ATAU custom ON.
  const on = flags[0] === 'themePreset'
    ? canUseTheme(business)
    : flags.every((f) => isFeatureOn(business, f));
  if (!on) return <Navigate to={fallback} replace />;
  return <>{children}</>;
}

function RequireTaxFeature({ children }: { children: React.ReactNode }) {
  const { business } = useCafe();
  // Halaman memuat 3 section (fee aplikasi + service + pajak) — terbuka bila
  // SALAH SATU menyala; section yang flag-nya mati dikunci di dalam halaman.
  const feeOn = business.platformFeeEnabled === true;
  if (feeOn || isFeatureOn(business, 'serviceCharge') || isFeatureOn(business, 'taxFees')) return <>{children}</>;
  return <Navigate to="/backoffice/settings/business" replace />;
}

export default function App() {
  return (
    <CafeProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/lupa-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/order/:token" element={<SelfOrderApp />} />

          {/* FRONT OFFICE ROUTES (formerly POS) */}
          <Route
            path="/frontoffice"
            element={
              <RequireAuth
                roles={["kasir", "barista", "owner"]}
                redirectTo="/frontoffice/orders"
              >
                <PosLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="orders" replace />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="catalog" element={<CatalogPage />} />
            <Route path="inventory" element={<RequireFeature flag="inventory" fallback="/frontoffice/orders"><InventoryPage /></RequireFeature>} />
            <Route path="manual" element={<ManualOrderPage />} />
            <Route path="settings" element={<PosSettingsPage />} />
          </Route>

          {/* BACK OFFICE ROUTES (formerly OWNER) */}
          <Route
            path="/backoffice"
            element={
              <RequireAuth roles={["owner"]} redirectTo="/backoffice/dashboard">
                <OwnerLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />

            {/* NESTED SALES ROUTES */}
            <Route path="sales">
              <Route index element={<Navigate to="omset" replace />} />
              <Route path="omset" element={<SalesOmsetPage />} />
              <Route path="performa" element={<RequireFeature flag={["analyticsFull", "performanceItem"]} fallback="/backoffice/sales/omset"><SalesPerformancePage /></RequireFeature>} />
              <Route path="riwayat" element={<SalesHistoryPage />} />
            </Route>

            <Route path="menu">
              <Route index element={<Navigate to="catalog" replace />} />
              <Route path="catalog" element={<MenuCatalogPage />} />
              <Route path="categories" element={<MenuCategoriesPage />} />
              <Route path="variants" element={<MenuVariantsPage />} />
            </Route>
            <Route path="tables" element={<RequireFeature flag="tableManagement" fallback="/backoffice/dashboard"><TablesPage /></RequireFeature>} />
            <Route path="staff" element={<StaffPage />} />
            <Route path="settings" element={<OwnerSettingsPage />}>
              <Route index element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<ProfileSettingsPage />} />
              <Route path="business" element={<CafeSettingsPage />} />
              <Route path="tax" element={<RequireTaxFeature><TaxSettingsPage /></RequireTaxFeature>} />
              <Route path="payment" element={<PaymentSettingsPage />} />
              <Route path="cafe" element={<Navigate to="business" replace />} />
            </Route>
          </Route>

          {/* Legacy redirects for backward compatibility */}
          <Route path="/pos/*" element={<Navigate to="/frontoffice/orders" replace />} />
          <Route path="/owner/*" element={<Navigate to="/backoffice/dashboard" replace />} />

          {/* 404 fallback — tidak mengganggu program, hanya tangani URL tidak dikenal */}
          <Route
            path="*"
            element={
              <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-center">
                <div>
                  <h1 className="font-display text-3xl font-bold">Halaman Tidak Ditemukan</h1>
                  <p className="mt-2 text-stone">URL tidak dikenal. Silakan kembali ke beranda.</p>
                  <a href={import.meta.env.BASE_URL} className="mt-4 inline-block rounded-full bg-black px-6 py-2 text-sm font-semibold text-white">
                    Kembali ke Beranda
                  </a>
                </div>
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </CafeProvider>
  );
}
