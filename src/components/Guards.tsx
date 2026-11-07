import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/auth-context'

export function FullPageSpinner() {
  return (
    <div className="grid min-h-[60vh] place-items-center" aria-busy="true" aria-live="polite">
      <div className="size-8 animate-spin rounded-full border-[3px] border-line border-t-ink" />
      <span className="sr-only">Loading</span>
    </div>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, profileError } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (profileError) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <p className="alert-error">Your profile couldn't load: {profileError}. Refresh the page to try again.</p>
      </div>
    )
  }
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (profile?.role !== 'admin') return <Navigate to="/profile" replace />
  return <>{children}</>
}
