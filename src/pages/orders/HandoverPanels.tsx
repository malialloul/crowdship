import { useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Camera, Check, KeyRound, MapPin, RefreshCw, ShieldCheck, X } from 'lucide-react'
import {
  confirmHandover,
  getHandoverCode,
  getHubToken,
  hubScanUrl,
  listProofs,
  regenerateHandoverCode,
  reviewProof,
  submitProof,
  uploadProofPhoto,
  validateProofFile,
  type ProofWithUrl,
} from '../../services/handover'
import { shortDate } from '../../lib/places'
import { messageOf } from '../../lib/errors'
import type { Hub, Order, Trip } from '../../lib/database.types'

export function Panel({ title, tone = 'plain', children }: { title: string; tone?: 'plain' | 'dark' | 'ok'; children: ReactNode }) {
  const cls =
    tone === 'dark'
      ? 'rounded-xl bg-ink p-6 text-white'
      : tone === 'ok'
        ? 'panel border-l-4 border-l-go p-6'
        : 'panel border-l-4 border-l-signal p-6'
  return (
    <section className={`space-y-3 ${cls}`}>
      <h2 className={`text-2xl ${tone === 'dark' ? 'text-white' : ''}`}>{title}</h2>
      <div className={tone === 'dark' ? 'space-y-3 text-white/80' : 'space-y-3 text-ink-soft'}>{children}</div>
    </section>
  )
}

export function HubAddress({ hub }: { hub: Hub }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-paper px-3 py-2 text-ink">
      <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">{hub.name}</p>
        <p className="text-sm text-ink-soft">{[hub.address, hub.area].filter(Boolean).join(', ')}</p>
        {hub.opening_hours && <p className="text-sm text-mist">{hub.opening_hours}</p>}
        {hub.maps_url && (
          <a href={hub.maps_url} target="_blank" rel="noreferrer noopener" className="text-sm font-semibold underline underline-offset-4">
            Open in Maps
          </a>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- proof (3.1)

function ProofGallery({ proofs }: { proofs: ProofWithUrl[] }) {
  if (proofs.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {proofs.map((p) => (
        <figure key={p.id} className="space-y-1">
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer" title="Open full size">
              <img src={p.url} alt={p.kind === 'item' ? 'Item' : 'Receipt'} className="aspect-square w-full rounded-md border border-line bg-paper object-cover" />
            </a>
          ) : (
            <div className="aspect-square w-full rounded-md bg-paper" />
          )}
          <figcaption className="text-xs font-semibold text-ink-soft">{p.kind === 'item' ? 'Item' : 'Receipt'}</figcaption>
        </figure>
      ))}
    </div>
  )
}

function PhotoPicker({ label, files, onChange }: { label: string; files: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div>
      <p className="field-label">{label}</p>
      <div className="flex flex-wrap gap-2">
        {files.map((f, i) => (
          <span key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-go-wash px-2.5 py-1.5 text-sm text-go">
            <Check className="size-3.5 shrink-0" aria-hidden />
            <span className="max-w-40 truncate">{f.name}</span>
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}>
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <button type="button" className="btn btn-quiet h-9 text-sm" onClick={() => input.current?.click()}>
          <Camera className="size-4" aria-hidden />
          Add photo
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, 4))
          e.target.value = ''
        }}
      />
    </div>
  )
}

/** Traveler: photos of the item and receipt, before the flight. */
export function ProofUploadPanel({ order, trip, onDone }: { order: Order; trip: Trip | undefined; onDone: () => void }) {
  const [items, setItems] = useState<File[]>([])
  const [receipts, setReceipts] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    const all = [...items, ...receipts]
    if (items.length === 0 || receipts.length === 0) return setError('Add at least one photo of the item and one of the receipt')
    const bad = all.map(validateProofFile).find(Boolean)
    if (bad) return setError(bad)
    setBusy(true)
    try {
      const itemPaths = await Promise.all(items.map((f) => uploadProofPhoto(order.id, f, 'item')))
      const receiptPaths = await Promise.all(receipts.map((f) => uploadProofPhoto(order.id, f, 'receipt')))
      await submitProof(order.id, itemPaths, receiptPaths)
      onDone()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <Panel title="Payment secured. Buy it, then send proof">
      <p>
        Buy the item, then take a clear photo of it and of the receipt{trip ? ` before your flight on ${shortDate(trip.travel_date)}` : ''}. The
        shopper checks them before you travel.
      </p>
      {order.proof_status === 'rejected' && order.proof_rejection_reason && (
        <p className="alert-error">The shopper asked for new photos: {order.proof_rejection_reason}</p>
      )}
      <PhotoPicker label="Item photos" files={items} onChange={setItems} />
      <PhotoPicker label="Receipt" files={receipts} onChange={setReceipts} />
      {error && <p className="alert-error">{error}</p>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Uploading…' : 'Send proof to the shopper'}
      </button>
    </Panel>
  )
}

export function useProofs(orderId: string, enabled: boolean, version: string) {
  const [proofs, setProofs] = useState<ProofWithUrl[]>([])
  useEffect(() => {
    if (!enabled) return
    listProofs(orderId).then(setProofs).catch(() => setProofs([]))
  }, [orderId, enabled, version])
  return proofs
}

/** Traveler: waiting for the shopper to approve. */
export function ProofSentPanel({ proofs }: { proofs: ProofWithUrl[] }) {
  return (
    <Panel title="Proof sent">
      <p>The shopper is checking your photos. You'll get a notification when they approve.</p>
      <ProofGallery proofs={proofs} />
    </Panel>
  )
}

/** Shopper: approve the photos, or ask for new ones. */
export function ProofReviewPanel({ order, proofs, onDone }: { order: Order; proofs: ProofWithUrl[]; onDone: () => void }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(approve: boolean) {
    setBusy(true)
    setError(null)
    try {
      await reviewProof(order.id, approve, approve ? undefined : reason)
      onDone()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <Panel title="Check the item photos">
      <p>Make sure it's the right item, model and size, and that the receipt matches.</p>
      <ProofGallery proofs={proofs} />
      {rejecting && (
        <div>
          <label htmlFor="proof-reason" className="field-label">
            What should the traveler fix?
          </label>
          <textarea id="proof-reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="It's the wrong colour; I asked for white" />
        </div>
      )}
      {error && <p className="alert-error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {!rejecting ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void decide(true)}>
              Approve item proof
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setRejecting(true)}>
              Ask for new photos
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ink" disabled={busy || !reason.trim()} onClick={() => void decide(false)}>
              Send request
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </>
        )}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- OTP (3.2)

/** Shopper: the 6-digit code, shown only to them. */
export function HandoverCodePanel({ order, version }: { order: Order; version: string }) {
  const [state, setState] = useState<{ code: string; attempts: number } | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getHandoverCode(order.id).then(setState).catch((e) => setError(messageOf(e)))
  }, [order.id, version])

  async function regenerate() {
    setBusy(true)
    setError(null)
    try {
      await regenerateHandoverCode(order.id)
      setState(await getHandoverCode(order.id))
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const locked = (state?.attempts ?? 0) >= 5
  return (
    <Panel title="Your handover code" tone="dark">
      <p>When you meet the traveler and have the item in your hands, read them this code. It releases their payment.</p>
      {state === undefined ? (
        <div className="h-16 animate-pulse rounded-lg bg-white/10" />
      ) : locked || !state ? (
        <p className="rounded-md bg-stop-wash px-3 py-2 text-sm text-stop">
          {state ? 'Too many wrong codes were tried. Make a new code before you meet.' : 'No code yet.'}
        </p>
      ) : (
        <p className="font-display text-6xl font-bold tracking-[0.25em] text-signal" aria-label={`Code ${state.code.split('').join(' ')}`}>
          {state.code}
        </p>
      )}
      <div className="flex items-center gap-2 text-sm text-white/60">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        Never share it before you've checked the item.
      </div>
      {error && <p className="rounded-md bg-stop-wash px-3 py-2 text-sm text-stop">{error}</p>}
      {(locked || !state) && state !== undefined && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void regenerate()}>
          <RefreshCw className="size-4" aria-hidden />
          Make a new code
        </button>
      )}
    </Panel>
  )
}

/** Traveler: types the shopper's code at the handover. */
export function EnterCodePanel({ order, onDone }: { order: Order; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function confirm() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await confirmHandover(order.id, code)
      if (r === 'released') {
        setMsg({ ok: true, text: 'Payment released. It will reach your Whish account shortly.' })
        onDone()
      } else if (r === 'locked') {
        setMsg({ ok: false, text: 'Too many wrong codes. Ask the shopper to make a new code in the app.' })
      } else {
        setMsg({ ok: false, text: "That code doesn't match. Check it with the shopper." })
      }
    } catch (err) {
      setMsg({ ok: false, text: messageOf(err) })
    } finally {
      setBusy(false)
      setCode('')
    }
  }

  return (
    <Panel title="Hand it over and get paid">
      <p>Meet the shopper and let them check the item. Then ask for their 6-digit code and enter it here.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="handover-code" className="field-label">
            Shopper's code
          </label>
          <input
            id="handover-code"
            className="input w-44 font-display text-2xl tracking-[0.3em]"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <button type="button" className="btn btn-primary" disabled={busy || code.length !== 6} onClick={() => void confirm()}>
          <KeyRound className="size-4" aria-hidden />
          {busy ? 'Checking…' : 'Confirm handover'}
        </button>
      </div>
      {msg && <p className={msg.ok ? 'alert-ok' : 'alert-error'}>{msg.text}</p>}
    </Panel>
  )
}

// ---------------------------------------------------------------- hub QR (3.3)

/** Traveler: QR for the hub operator to scan. */
export function HubQrPanel({ order, hub, version }: { order: Order; hub: Hub | undefined; version: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getHubToken(order.id)
      .then((t) => (t ? QRCode.toString(hubScanUrl(t), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null))
      .then(setSvg)
      .catch((e) => setError(messageOf(e)))
  }, [order.id, version])

  return (
    <Panel title="Drop it at the hub">
      <p>Bring the item to the hub and show this code to the staff. Scanning it releases your payment.</p>
      {hub && <HubAddress hub={hub} />}
      {error && <p className="alert-error">{error}</p>}
      {svg ? (
        <div
          className="mx-auto w-full max-w-64 rounded-lg bg-white p-3 [&>svg]:h-auto [&>svg]:w-full"
          role="img"
          aria-label="Drop-off QR code"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        !error && <div className="mx-auto aspect-square w-full max-w-64 animate-pulse rounded-lg bg-paper" />
      )}
      <p className="text-center text-sm text-mist">Turn your screen brightness up if the scan doesn't work.</p>
    </Panel>
  )
}
