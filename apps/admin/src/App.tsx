import { Navigate, Route, Routes } from 'react-router-dom'
import { PlatformProvider, RequirePlatform } from './auth/PlatformAuth'
import { PlatformLayout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { TenantsPage } from './pages/TenantsPage'
import { TenantDetailPage } from './pages/TenantDetailPage'
import { UsersPage } from './pages/UsersPage'
import { PlansPage } from './pages/PlansPage'
import { InvoicesPage } from './pages/InvoicesPage'
import { LeadsPage } from './pages/LeadsPage'
import { ContentPage } from './pages/ContentPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { AuditPage } from './pages/AuditPage'

export default function App() {
  return (
    <PlatformProvider>
      <Routes>
        <Route path="/platform/login" element={<LoginPage />} />
        <Route
          path="/platform"
          element={
            <RequirePlatform>
              <PlatformLayout />
            </RequirePlatform>
          }
        >
          <Route index element={<Navigate to="tenants" replace />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="tenants/:id" element={<TenantDetailPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="content" element={<ContentPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="audit" element={<AuditPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/platform/tenants" replace />} />
        <Route path="*" element={<Navigate to="/platform/tenants" replace />} />
      </Routes>
    </PlatformProvider>
  )
}
