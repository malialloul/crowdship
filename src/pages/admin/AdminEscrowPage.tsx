import { useCallback, useEffect, useState } from 'react'
import {
  feesEarned,
  listEscrowsAdmin,
  listQueuedPayouts,
  markPayoutPaid,
  releaseEscrow,
  type AdminEscrow,
  type AdminPayout,
} from '../../services/escrow'
import { EscrowTag } from '../../components/StatusTags'
import { MoneyBreakdown, splitFromEscrow } from '../../components/MoneyBreakdown'
import { Check, Copy } from 'lucide-react'
import { formatPhone } from '../../lib/phone'
import { messageOf } from '../../lib/errors'
import { dateTime, money } from '../../lib/format'
import type { EscrowStatus } from '../../lib/database.types'

const FILTERS: { id: EscrowStatus | 'ALL'; label: string }[] = [
  { id: 'HELD', label: 'Held' },
  { id: 'PENDING_PAYMENT', label: 'Awaiting payment' },
  { id: 'RELEASED', label: 'Released' },
  { id: 'FAILED', label: 'Failed' },
  { id: 'ALL', label: 'All' },
]

function ReleaseControl({ escrow, onDone }: { escrow: AdminEscrow; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function release() {
    setBusy(true)
    setError(null)
    try {
      await releaseEscrow(escrow.id)
      onDone()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="btn btn-primary h-9 text-sm" onClick={() => setConfirming(true)}>
        Release to traveler
      </button>
    )
  }
  return (
    <div className="w-full space-y-3 rounded-md bg-signal-wash p-3 sm:w-72">
      <p className="text-sm font-semibold">Release to {escrow.traveler?.full_name || 'the traveler'}? This can't be undone.</p>
      <MoneyBreakdown split={splitFromEscrow(escrow)} viewer="admin" />
      {error && <p className="alert-error">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-ink h-9 text-sm" disabled={busy} onClick={() => void release()}>
          {busy ? 'Releasing…' : 'Confirm release'}
        </button>
        <button type="button" className="btn btn-quiet h-9 text-sm" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-quiet h-9 text-sm"
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? 'Copied' : label}
    </button>
  )
}

function PayoutRow({ payout, onDone }: { payout: AdminPayout; onDone: () => void }) {
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await markPayoutPaid(payout.id, ref)
      onDone()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[15px]">
          Send to <strong>{payout.traveler?.full_name || 'Traveler'}</strong> on Whish{' '}
          <strong>{formatPhone(payout.whish_phone) || 'no number on file'}</strong>
        </p>
        <p className="text-sm text-mist">Queued {dateTime(payout.created_at)}</p>
      </div>
      <div className="max-w-sm">
        {payout.escrow ? (
          <MoneyBreakdown split={splitFromEscrow(payout.escrow)} viewer="admin" />
        ) : (
          <p className="font-display text-xl font-semibold">{money(payout.amount, payout.currency)}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyValue label={`Copy ${money(payout.amount, payout.currency)}`} value={String(payout.amount)} />
        {payout.whish_phone && <CopyValue label="Copy number" value={payout.whish_phone} />}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Whish transfer reference (optional)"
          className="input h-9 max-w-xs text-sm"
          placeholder="Whish reference (optional)"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <button type="button" className="btn btn-ink h-9 text-sm" disabled={busy} onClick={() => void submit()}>
          Mark as sent
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </li>
  )
}

export default function AdminEscrowPage() {
  const [filter, setFilter] = useState<EscrowStatus | 'ALL'>('HELD')
  const [rows, setRows] = useState<AdminEscrow[] | null>(null)
  const [payouts, setPayouts] = useState<AdminPayout[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fees, setFees] = useState<Awaited<ReturnType<typeof feesEarned>>>([])

  const load = useCallback(async (f: EscrowStatus | 'ALL') => {
    try {
      const [e, p, fe] = await Promise.all([listEscrowsAdmin(f), listQueuedPayouts(), feesEarned()])
      setRows(e)
      setPayouts(p)
      setFees(fe)
      setError(null)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [])

  useEffect(() => {
    setRows(null)
    void load(filter)
  }, [filter, load])

  const refresh = () => void load(filter)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl">Escrow</h1>
        <p className="mt-1 text-ink-soft">Release held funds once the handover is confirmed, then send the traveler's payout from the Whish business account.</p>
      </div>

      {error && <p className="alert-error">{error}</p>}

      <section className="flex flex-wrap gap-3">
        <div className="rounded-xl bg-ink px-5 py-4 text-white">
          <p className="text-sm text-white/60">Service fees earned</p>
          <p className="font-display text-3xl font-bold text-signal">
            {fees.length === 0 ? money(0, 'USD') : fees.map((f) => money(f.total, f.currency)).join(' + ')}
          </p>
          <p className="text-sm text-white/60">
            {fees.reduce((n, f) => n + f.orders, 0)} completed order{fees.reduce((n, f) => n + f.orders, 0) === 1 ? '' : 's'}
          </p>
        </div>
      </section>

      {payouts && payouts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">Payouts to send ({payouts.length})</h2>
          <ul className="panel divide-y divide-line border-signal-deep">
            {payouts.map((p) => (
              <PayoutRow key={p.id} payout={p} onDone={refresh} />
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl">Holds</h2>
          <label className="flex items-center gap-2 text-sm font-semibold">
            Show
            <select className="input h-9 w-auto text-sm" value={filter} onChange={(e) => setFilter(e.target.value as EscrowStatus | 'ALL')}>
              {FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="panel">
          {rows === null ? (
            <p className="p-6 text-mist">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-ink-soft">No holds with this status.</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                  <div className="min-w-48 flex-1 space-y-0.5">
                    <p className="font-display text-xl font-semibold">
                      {money(e.total_amount, e.currency)}{' '}
                      <span className="text-[15px] font-medium text-mist">
                        item {money(e.item_amount, e.currency)} · traveler {money(e.reward_amount, e.currency)}
                        {e.platform_fee > 0 && ` · app ${money(e.platform_fee, e.currency)}${e.fee_payer === 'traveler' ? ' (from traveler)' : ''}`}
                      </span>
                    </p>
                    <p className="truncate text-sm text-ink-soft">
                      {e.shopper?.full_name || formatPhone(e.shopper?.phone) || 'Shopper'} pays{' '}
                      {e.traveler?.full_name || formatPhone(e.traveler?.phone) || 'Traveler'}
                    </p>
                    <p className="truncate text-sm text-mist">
                      Hold #{e.whish_external_id}, created {dateTime(e.created_at)}
                      {e.held_at && `, held ${dateTime(e.held_at)}`}
                    </p>
                  </div>
                  <EscrowTag status={e.status} />
                  {e.status === 'HELD' && <ReleaseControl escrow={e} onDone={refresh} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
