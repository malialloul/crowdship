import { useEffect, useState } from 'react'

export interface AuthProviders {
  phone: boolean
  google: boolean
}

/**
 * Reads which sign-in methods are switched on in Supabase (Authentication →
 * Providers), so the login page never sends people to a disabled provider.
 * Returns null while loading or if the check fails (then everything is shown).
 */
export function useAuthProviders(): AuthProviders | null {
  const [providers, setProviders] = useState<AuthProviders | null>(null)

  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
    if (!url || !key) return
    const ctrl = new AbortController()
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { external?: Record<string, boolean> } | null) => {
        if (s?.external) setProviders({ phone: !!s.external.phone, google: !!s.external.google })
      })
      .catch(() => undefined)
    return () => ctrl.abort()
  }, [])

  return providers
}
