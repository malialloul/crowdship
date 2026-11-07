import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { listMyEscrows } from '../services/escrow'
import { EscrowTag } from '../components/StatusTags'
import { messageOf } from '../lib/errors'
import { dateTime, money } from '../lib/format'
import type { Escrow } from '../lib/database.types'

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
      {e.order_id && (
        <Link to={`/orders/${e.order_id}`} className="text-sm font-semibold underline underline-offset-4">
          View order
        </Link>
      )}
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
          <p className="p-6 text-ink-soft">No payments yet. When you accept a traveler's offer and pay, the hold appears here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <EscrowRow key={e.id} e={e} me={user!.id} />
            ))}
          </ul>
        )}
      </section>

    </div>
  )
}
