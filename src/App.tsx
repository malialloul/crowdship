import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { AppShell } from './components/AppShell'
import { FullPageSpinner, RequireAdmin, RequireAuth } from './components/Guards'
import LoginPage from './pages/LoginPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import ProfilePage from './pages/ProfilePage'

const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const PaymentReturnPage = lazy(() => import('./pages/PaymentReturnPage'))
const MockWhishPage = lazy(() => import('./pages/MockWhishPage'))
const AdminKycPage = lazy(() => import('./pages/admin/AdminKycPage'))
const AdminEscrowPage = lazy(() => import('./pages/admin/AdminEscrowPage'))

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/payments/:escrowId/return" element={<PaymentReturnPage />} />
            <Route path="/payments/:escrowId/mock-whish" element={<MockWhishPage />} />
            <Route path="/admin/kyc" element={<RequireAdmin><AdminKycPage /></RequireAdmin>} />
            <Route path="/admin/escrow" element={<RequireAdmin><AdminEscrowPage /></RequireAdmin>} />
          </Route>

          <Route path="*" element={<Navigate to="/profile" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
