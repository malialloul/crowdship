import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { listMyEscrows, startPaymentHold } from '../services/escrow'
import { EscrowTag } from '../components/StatusTags'
import { messageOf } from '../lib/errors'
import { dateTime, money } from '../lib/format'
import type { Currency, Escrow } from '../lib/database.types'

const SHOW_TEST_FORM = import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_HOLDS === 'true'

function TestHoldForm() {
  const { profile } = useAuth()
  const [travelerId, setTravelerId] = useState('')
  const [item, setItem] = useState('120')
  const [reward, setReward] = useState('25')
  const [currency, setCurrency] = useState<Currency>('USD')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const hold = await startPaymentHold({
        traveler_id: travelerId.trim(),
        item_amount: Number(item),
        reward_amount: Number(reward),
        currency,
      })
      window.location.assign(hold.collect_url) // to Whish (or the mock checkout)
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel space-y-4 border-dashed p-6" noValidate>
      <div>
        <h2 className="text-2xl">Start a test hold</h2>
        <p className="mt-1 text-ink-soft">
          Stand-in for "accept offer" until Sprint 2. Both accounts need a Verified badge. Paste the traveler's user ID from their profile page.
        </p>
      </div>
      {profile?.kyc_status !== 'verified' && <p className="alert-error">Your own identity must be verified before you can pay.</p>}
      <div>
        <label htmlFor="traveler" className="field-label">
          Traveler user ID
        </label>
        <input
          id="traveler"
          className="input font-mono text-sm"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={travelerId}
          onChange={(e) => setTravelerId(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-[1fr_1fr_6rem] gap-3">
        <div>
          <label htmlFor="item" className="field-label">
            Item price
          </label>
          <input id="item" className="input" inputMode="decimal" value={item} onChange={(e) => setItem(e.target.value)} />
        </div>
        <div>
          <label htmlFor="reward" className="field-label">
            Traveler reward
          </label>
          <input id="reward" className="input" inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)} />
        </div>
        <div>
          <label htmlFor="cur" className="field-label">
            Currency
          </label>
          <select id="cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            <option value="USD">USD</option>
            <option value="LBP">LBP</option>
          </select>
        </div>
      </div>
      {error && <p className="alert-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy || !travelerId.trim()}>
        {busy ? 'Opening Whish…' : 'Pay with Whish'}
      </button>
    </form>
  )
}

function EscrowRow({ e, me }: { e: Escrow; me: string }) {
  const paying = e.shopper_id === me
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
      <div className="min-w-40 flex-1">
        <p className="font-display text-xl font-semibold">{money(e.total_amount, e.currency)}</p>
        <p className="flex flex-wrap gap-x-3 text-sm text-mist">
          <span className="font-semibold text-ink-soft">{paying ? 'You pay' : 'You receive'}</span>
          <span>Hold #{e.whish_external_id}</span>
          <span>{dateTime(e.created_at)}</span>
        </p>
      </div>
      <EscrowTag status={e.status} />
      {paying && e.status === 'PENDING_PAYMENT' && (
        <Link to={`/payments/${e.id}/return`} className="text-sm font-semibold underline underline-offset-4">
          Check payment
        </Link>
      )}
    </li>
  )
}

export default function PaymentsPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Escrow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await listMyEscrows())
    } catch (err) {
      setError(messageOf(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-4xl">Payments</h1>
        <p className="mt-1 text-ink-soft">Money you've placed in escrow, and money held for trips you're carrying.</p>
      </div>

      {error && <p className="alert-error">{error}</p>}

      <section className="panel">
        {rows === null ? (
          <p className="p-6 text-mist">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-ink-soft">No payments yet. When you accept a traveler's offer, the payment hold appears here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <EscrowRow key={e.id} e={e} me={user!.id} />
            ))}
          </ul>
        )}
      </section>

      {SHOW_TEST_FORM && <TestHoldForm />}
    </div>
  )
}
