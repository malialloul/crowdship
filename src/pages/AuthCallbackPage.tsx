import { Link, Navigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { FullPageSpinner } from '../components/Guards'

// Google redirects here; supabase-js exchanges the ?code= for a session on load.
export default function AuthCallbackPage() {
  const { user, loading } = useAuth()
  const params = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const oauthError = params.get('error_description') ?? hash.get('error_description')

  if (oauthError) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-16">
        <p className="alert-error">Google sign-in didn't complete: {oauthError}</p>
        <Link to="/login" className="btn btn-quiet">
          Back to sign in
        </Link>
      </div>
    )
  }
  if (loading) return <FullPageSpinner />
  return <Navigate to={user ? '/orders' : '/login'} replace />
}
