import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { CircleAlert, Clock, ShieldCheck } from 'lucide-react'
import { getEscrow, verifyPayment } from '../services/escrow'
import { messageOf } from '../lib/errors'
import { money } from '../lib/format'
import type { Escrow, EscrowStatus } from '../lib/database.types'

const POLL_MS = 3000
const MAX_POLLS = 6

// Whish sends the shopper back here. The URL's ?result= is never trusted;
// the status always comes from the server, which asks Whish directly.
export default function PaymentReturnPage() {
  const { escrowId = '' } = useParams()
  const [escrow, setEscrow] = useState<Escrow | null>(null)
  const [status, setStatus] = useState<EscrowStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const polls = useRef(0)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const res = await verifyPayment(escrowId)
      setStatus(res.status)
      setError(null)
      return res.status
    } catch (err) {
      setError(messageOf(err))
      return null
    } finally {
      setChecking(false)
    }
  }, [escrowId])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    polls.current = 0

    void getEscrow(escrowId).then(setEscrow).catch(() => undefined)

    const tick = async () => {
      const s = await check()
      polls.current += 1
      if (!cancelled && s === 'PENDING_PAYMENT' && polls.current < MAX_POLLS) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [escrowId, check])

  const amount = escrow ? money(escrow.total_amount, escrow.currency) : null

  return (
    <div className="mx-auto max-w-lg">
      <div className="panel space-y-5 p-6 sm:p-8">
        {status === 'HELD' || status === 'RELEASED' ? (
          <>
            <ShieldCheck className="size-10 text-go" aria-hidden />
            <h1 className="text-3xl">{amount ? `${amount} is held in escrow` : 'Payment held in escrow'}</h1>
            <p className="text-ink-soft">
              The traveler can now buy your item. They're paid only after you confirm the handover, so your money stays protected until then.
            </p>
          </>
        ) : status === 'FAILED' || status === 'CANCELLED' ? (
          <>
            <CircleAlert className="size-10 text-stop" aria-hidden />
            <h1 className="text-3xl">Payment didn't go through</h1>
            <p className="text-ink-soft">Whish didn't take any money for this hold. You can try again from the order.</p>
          </>
        ) : (
          <>
            <Clock className="size-10 text-mist" aria-hidden />
            <h1 className="text-3xl">{status ? 'Waiting for Whish to confirm' : 'Checking your payment'}</h1>
            <p className="text-ink-soft">
              If you finished paying in Whish, confirmation usually arrives within a few seconds. You can leave this page; the hold updates on its own.
            </p>
            {status === 'PENDING_PAYMENT' && (
              <button type="button" className="btn btn-quiet" onClick={() => void check()} disabled={checking}>
                {checking ? 'Checking…' : 'Check again'}
              </button>
            )}
          </>
        )}
        {error && <p className="alert-error">{error}</p>}
        <Link to={escrow?.order_id ? `/orders/${escrow.order_id}` : '/payments'} className="btn btn-ink w-full">
          {escrow?.order_id ? 'Back to the order' : 'Go to payments'}
        </Link>
      </div>
    </div>
  )
}
