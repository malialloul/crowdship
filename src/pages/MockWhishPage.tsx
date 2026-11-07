import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { getEscrow, verifyPayment } from '../services/escrow'
import { messageOf } from '../lib/errors'
import { money } from '../lib/format'
import type { Escrow } from '../lib/database.types'

// Only reached when the Edge Functions run with WHISH_MODE=mock.
// Stands in for the Whish checkout so the hold flow can be tested end to end.
export default function MockWhishPage() {
  const { escrowId = '' } = useParams()
  const navigate = useNavigate()
  const [escrow, setEscrow] = useState<Escrow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getEscrow(escrowId).then(setEscrow).catch((e) => setError(messageOf(e)))
  }, [escrowId])

  async function finish(outcome: 'success' | 'failed') {
    setBusy(true)
    setError(null)
    try {
      await verifyPayment(escrowId, outcome)
      navigate(`/payments/${escrowId}/return?result=${outcome === 'success' ? 'success' : 'failure'}`, { replace: true })
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <div className="overflow-hidden rounded-xl border-2 border-dashed border-ink-soft bg-card">
        <p className="bg-ink px-5 py-2 text-sm font-semibold text-signal">Test checkout. No real money moves.</p>
        <div className="space-y-5 p-6">
          <div>
            <p className="text-sm text-mist">Whish payment request</p>
            <p className="font-display text-4xl font-bold">{escrow ? money(escrow.total_amount, escrow.currency) : '…'}</p>
            {escrow && <p className="text-sm text-mist">Escrow hold #{escrow.whish_external_id}</p>}
          </div>
          {error && <p className="alert-error">{error}</p>}
          <div className="grid gap-2">
            <button type="button" className="btn btn-primary" disabled={busy || !escrow} onClick={() => void finish('success')}>
              Approve payment
            </button>
            <button type="button" className="btn btn-danger" disabled={busy || !escrow} onClick={() => void finish('failed')}>
              Decline payment
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
