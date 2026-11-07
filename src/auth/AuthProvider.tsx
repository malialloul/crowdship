import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { fetchProfile } from '../services/profile'
import { messageOf } from '../lib/errors'
import type { Profile } from '../lib/database.types'
import { AuthContext, type AuthState } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionReady(true)
    })
    // Keep this callback synchronous: awaiting supabase calls inside it can deadlock the auth client.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setSessionReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  const refreshProfile = useCallback(async () => {
    if (!userId) return
    try {
      setProfile(await fetchProfile(userId))
      setProfileError(null)
    } catch (err) {
      setProfileError(messageOf(err))
    }
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      setProfileError(null)
      return
    }
    void refreshProfile()
  }, [userId, refreshProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthState>(() => {
    // Never expose a previous user's profile while the next one loads.
    const current = profile && profile.id === userId ? profile : null
    return {
      session,
      user: session?.user ?? null,
      profile: current,
      profileError,
      loading: !sessionReady || (userId !== null && current === null && profileError === null),
      refreshProfile,
      signOut,
    }
  }, [session, profile, profileError, sessionReady, userId, refreshProfile, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
