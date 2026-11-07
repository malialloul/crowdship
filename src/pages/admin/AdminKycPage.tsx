import { useCallback, useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { listKycSubmissions, reviewKyc, signedDocumentUrl, type KycReviewItem } from '../../services/profile'
import { VerificationBadge } from '../../components/StatusTags'
import { formatPhone } from '../../lib/phone'
import { messageOf } from '../../lib/errors'
import { dateTime } from '../../lib/format'

type Tab = 'pending' | 'verified' | 'rejected'
const TABS: { id: Tab; label: string }[] = [
  { id: 'pending', label: 'Waiting' },
  { id: 'verified', label: 'Approved' },
  { id: 'rejected', label: 'Declined' },
]

function DocumentPreview({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isPdf = path.endsWith('.pdf')

  useEffect(() => {
    signedDocumentUrl(path).then(setUrl).catch((e) => setError(messageOf(e)))
  }, [path])

  return (
    <figure className="space-y-1.5">
      <figcaption className="text-sm font-semibold">{label}</figcaption>
      {error ? (
        <p className="alert-error">{error}</p>
      ) : !url ? (
        <div className="aspect-[1.58] animate-pulse rounded-md bg-paper" />
      ) : isPdf ? (
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-quiet w-full">
          <ExternalLink className="size-4" aria-hidden /> Open PDF
        </a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" title="Open full size">
          <img src={url} alt={label} className="w-full rounded-md border border-line object-contain" />
        </a>
      )}
    </figure>
  )
}

function ReviewCard({ item, onDone }: { item: KycReviewItem; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(approve: boolean) {
    setBusy(true)
    setError(null)
    try {
      await reviewKyc(item.id, approve, approve ? undefined : reason)
      onDone()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  const name = item.user?.full_name || 'No name given'
  return (
    <article className="panel space-y-5 p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-2xl">{name}</h2>
          <p className="flex flex-wrap gap-x-4 text-sm text-ink-soft">
            {item.user?.phone && <span>{formatPhone(item.user.phone)}</span>}
            {item.user?.email && <span className="truncate">{item.user.email}</span>}
          </p>
          <p className="mt-1 text-sm text-mist">
            {item.document_type === 'national_id' ? 'Lebanese ID card' : 'Passport'}, submitted {dateTime(item.created_at)}
          </p>
        </div>
        <VerificationBadge status={item.status} />
      </header>

      <div className={`grid gap-4 ${item.document_back_path ? 'sm:grid-cols-2' : 'max-w-md'}`}>
        <DocumentPreview path={item.document_path} label={item.document_type === 'national_id' ? 'Front' : 'Photo page'} />
        {item.document_back_path && <DocumentPreview path={item.document_back_path} label="Back" />}
      </div>

      {item.status === 'rejected' && item.rejection_reason && <p className="text-sm text-ink-soft">Declined because: {item.rejection_reason}</p>}

      {item.status === 'pending' && (
        <div className="space-y-3 border-t border-line pt-4">
          {rejecting && (
            <div>
              <label htmlFor={`reason-${item.id}`} className="field-label">
                Reason shown to the user
              </label>
              <textarea
                id={`reason-${item.id}`}
                className="input"
                rows={2}
                placeholder="e.g. The back of the ID is blurry"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
          {error && <p className="alert-error">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {!rejecting ? (
              <>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void decide(true)}>
                  Approve identity
                </button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRejecting(true)}>
                  Decline…
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => void decide(false)}>
                  Decline identity
                </button>
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setRejecting(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

export default function AdminKycPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [items, setItems] = useState<KycReviewItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (t: Tab) => {
    setItems(null)
    try {
      setItems(await listKycSubmissions(t))
      setError(null)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [])

  useEffect(() => {
    void load(tab)
  }, [tab, load])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl">ID reviews</h1>
          <p className="mt-1 text-ink-soft">Check that the document is readable and the name matches the profile.</p>
        </div>
        <div className="flex rounded-md border border-line bg-card p-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`whitespace-nowrap rounded px-3 py-1.5 text-[15px] font-semibold ${tab === t.id ? 'bg-ink text-white' : 'text-ink-soft'}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="alert-error">{error}</p>}
      {items === null && !error && <p className="text-mist">Loading…</p>}
      {items?.length === 0 && (
        <p className="panel p-6 text-ink-soft">{tab === 'pending' ? 'Nothing waiting. New submissions show up here.' : 'None yet.'}</p>
      )}
      <div className="space-y-4">
        {items?.map((item) => (
          <ReviewCard key={item.id} item={item} onDone={() => void load(tab)} />
        ))}
      </div>
    </div>
  )
}
