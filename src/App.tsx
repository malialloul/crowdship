import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { NotificationsProvider } from './notifications/NotificationsProvider'
import { AppShell } from './components/AppShell'
import { FullPageSpinner, RequireAdmin, RequireAuth } from './components/Guards'
import LoginPage from './pages/LoginPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import ProfilePage from './pages/ProfilePage'

const OrdersPage = lazy(() => import('./pages/orders/OrdersPage'))
const NewOrderPage = lazy(() => import('./pages/orders/NewOrderPage'))
const OrderPage = lazy(() => import('./pages/orders/OrderPage'))
const TripsPage = lazy(() => import('./pages/trips/TripsPage'))
const NewTripPage = lazy(() => import('./pages/trips/NewTripPage'))
const TripPage = lazy(() => import('./pages/trips/TripPage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const PaymentReturnPage = lazy(() => import('./pages/PaymentReturnPage'))
const MockWhishPage = lazy(() => import('./pages/MockWhishPage'))
const AdminKycPage = lazy(() => import('./pages/admin/AdminKycPage'))
const AdminEscrowPage = lazy(() => import('./pages/admin/AdminEscrowPage'))

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <NotificationsProvider>
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
            <Route path="/search" element={<SearchPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/new" element={<NewOrderPage />} />
            <Route path="/orders/:orderId" element={<OrderPage />} />
            <Route path="/trips" element={<TripsPage />} />
            <Route path="/trips/new" element={<NewTripPage />} />
            <Route path="/trips/:tripId" element={<TripPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/payments/:escrowId/return" element={<PaymentReturnPage />} />
            <Route path="/payments/:escrowId/mock-whish" element={<MockWhishPage />} />
            <Route path="/admin/kyc" element={<RequireAdmin><AdminKycPage /></RequireAdmin>} />
            <Route path="/admin/escrow" element={<RequireAdmin><AdminEscrowPage /></RequireAdmin>} />
          </Route>

          <Route path="*" element={<Navigate to="/orders" replace />} />
        </Routes>
        </Suspense>
        </NotificationsProvider>
      </BrowserRouter>
    </AuthProvider>
  )
}
