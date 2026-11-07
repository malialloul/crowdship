import type { EscrowStatus, KycStatus } from '../lib/database.types'

const KYC: Record<KycStatus, { label: string; cls: string }> = {
  not_submitted: { label: 'Not verified', cls: 'bg-line text-ink-soft' },
  pending: { label: 'Pending Verification', cls: 'bg-signal text-ink' },
  verified: { label: 'Verified', cls: 'bg-go text-white' },
  rejected: { label: 'Verification declined', cls: 'bg-stop text-white' },
}

export function VerificationBadge({ status }: { status: KycStatus }) {
  const { label, cls } = KYC[status]
  return (
    <span className={`tag ${cls}`} role="status">
      {label}
    </span>
  )
}

const ESCROW: Record<EscrowStatus, { label: string; cls: string }> = {
  PENDING_PAYMENT: { label: 'Awaiting payment', cls: 'bg-signal-wash text-ink' },
  HELD: { label: 'Held in escrow', cls: 'bg-signal text-ink' },
  RELEASED: { label: 'Released', cls: 'bg-go text-white' },
  REFUNDED: { label: 'Refunded', cls: 'bg-ink-soft text-white' },
  FAILED: { label: 'Payment failed', cls: 'bg-stop text-white' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-line text-ink-soft' },
}

export function EscrowTag({ status }: { status: EscrowStatus }) {
  const { label, cls } = ESCROW[status]
  return <span className={`tag ${cls}`}>{label}</span>
}
