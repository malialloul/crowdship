import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

if (!url || !key) {
  throw new Error(
    `Missing ${[!url && 'VITE_SUPABASE_URL', !key && 'VITE_SUPABASE_ANON_KEY'].filter(Boolean).join(' and ')}. ` +
      'They are read at build time.',
  )
}
if (!/^https?:\/\/[^/\s]+\/?$/.test(url)) {
  throw new Error(
    `VITE_SUPABASE_URL should look like https://<project-ref>.supabase.co (got "${url}").`,
  )
}

export const supabase = createClient<Database>(url.replace(/\/$/, ''), key, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Crowdship'
