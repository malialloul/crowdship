import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { COUNTRIES, formatPhone, toE164 } from '../lib/phone'
import { messageOf } from '../lib/errors'
import { useAuth } from '../auth/auth-context'
import { Wordmark } from '../components/AppShell'
import { FullPageSpinner } from '../components/Guards'
import { useAuthProviders } from '../lib/authProviders'

const ROUTES = [
  { code: 'DXB', city: 'Dubai' },
  { code: 'IST', city: 'Istanbul' },
  { code: 'CDG', city: 'Paris' },
  { code: 'LHR', city: 'London' },
  { code: 'JFK', city: 'New York' },
]

const RESEND_SECONDS = 60

function RouteBoard() {
  return (
    <div className="rounded-xl bg-ink p-5 text-white sm:p-6" aria-hidden>
      <ul className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-x-3 gap-y-2.5 font-display sm:gap-x-4">
        {ROUTES.map((r) => (
          <li key={r.code} className="contents">
            <span className="text-3xl font-bold tracking-wide text-signal sm:text-4xl">{r.code}</span>
            <span className="text-[15px] text-white/60">{r.city}</span>
            <span className="relative h-px bg-white/25">
              <span className="absolute -top-[3px] right-0 size-[7px] rotate-45 border-t border-r border-white/50" />
            </span>
            <span className="text-3xl font-bold tracking-wide sm:text-4xl">BEY</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.8 3.6-4.9 6.7-4.9z" />
    </svg>
  )
}

export default function LoginPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/orders'

  const [dial, setDial] = useState('961')
  const [number, setNumber] = useState('')
  const [phone, setPhone] = useState<string | null>(null) // E.164 once the code is sent
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const providers = useAuthProviders()
  const showPhone = providers?.phone ?? true
  const showGoogle = providers?.google ?? true

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  if (loading) return <FullPageSpinner />
  if (user) return <Navigate to={from} replace />

  async function sendCode(e164: string) {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 })
    setBusy(false)
    if (error) {
      setError(error.message)
      return false
    }
    setCooldown(RESEND_SECONDS)
    return true
  }

  async function onSubmitPhone(e: FormEvent) {
    e.preventDefault()
    const parsed = toE164(number, dial)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (await sendCode(parsed.e164)) setPhone(parsed.e164)
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault()
    if (!phone) return
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from the SMS')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate(from, { replace: true })
  }

  async function signInWithGoogle() {
    setError(null)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <div className="mx-auto grid min-h-dvh max-w-5xl content-center gap-8 px-4 py-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
      <section className="space-y-6">
        <Wordmark />
        <h1 className="text-4xl sm:text-5xl">Shop anywhere. A traveler brings it to Lebanon.</h1>
        <p className="max-w-prose text-lg text-ink-soft">
          Your payment waits in Whish escrow and reaches the traveler only after the item is in your hands.
        </p>
        <RouteBoard />
      </section>

      <section className="panel self-center p-6 sm:p-8">
        {!showPhone && !showGoogle ? (
          <div className="space-y-3">
            <h2 className="text-2xl">Sign-in isn't set up yet</h2>
            <p className="text-ink-soft">
              Turn on Phone or Google in Supabase under Authentication → Providers, then reload this page.
            </p>
          </div>
        ) : !phone ? (
          <form onSubmit={onSubmitPhone} noValidate className="space-y-5">
            <div>
              <h2 className="text-2xl">Sign in or create an account</h2>
              {showPhone && <p className="mt-1 text-ink-soft">We'll text you a 6-digit code.</p>}
            </div>

            {showPhone && (
              <>
                <div>
                  <label htmlFor="phone" className="field-label">
                    Mobile number
                  </label>
                  <div className="flex gap-2">
                    <select
                      aria-label="Country code"
                      className="input w-[7.5rem] shrink-0 pr-1"
                      value={dial}
                      onChange={(e) => setDial(e.target.value)}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.iso} value={c.dial}>
                          {c.iso} +{c.dial}
                        </option>
                      ))}
                    </select>
                    <input
                      id="phone"
                      className="input"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder={dial === '961' ? '71 123 456' : 'Phone number'}
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                    />
                  </div>
                  <p className="field-hint">Lebanese or international numbers both work.</p>
                </div>

                <button type="submit" className="btn btn-primary w-full" disabled={busy}>
                  {busy ? 'Sending code…' : 'Send code'}
                </button>
              </>
            )}

            {error && <p className="alert-error" role="alert">{error}</p>}

            {showPhone && showGoogle && (
              <div className="flex items-center gap-3 text-sm text-mist">
                <span className="h-px flex-1 bg-line" />
                or
                <span className="h-px flex-1 bg-line" />
              </div>
            )}

            {showGoogle && (
              <button
                type="button"
                className={`btn w-full ${showPhone ? 'btn-quiet' : 'btn-primary'}`}
                onClick={() => void signInWithGoogle()}
              >
                <GoogleIcon />
                Continue with Google
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={onSubmitCode} noValidate className="space-y-5">
            <div>
              <h2 className="text-2xl">Enter your code</h2>
              <p className="mt-1 text-ink-soft">Sent by SMS to {formatPhone(phone)}.</p>
            </div>

            <div>
              <label htmlFor="otp" className="field-label">
                6-digit code
              </label>
              <input
                id="otp"
                className="input font-display text-2xl tracking-[0.4em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>

            {error && <p className="alert-error" role="alert">{error}</p>}

            <button type="submit" className="btn btn-primary w-full" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Verify and continue'}
            </button>

            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <button
                type="button"
                className="font-semibold text-ink-soft underline-offset-4 hover:underline"
                onClick={() => {
                  setPhone(null)
                  setCode('')
                  setError(null)
                }}
              >
                Use a different number
              </button>
              <button
                type="button"
                className="font-semibold text-ink underline-offset-4 hover:underline disabled:text-mist disabled:no-underline"
                disabled={cooldown > 0 || busy}
                onClick={() => void sendCode(phone)}
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
