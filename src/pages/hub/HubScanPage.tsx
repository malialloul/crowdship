import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { CheckCircle2 } from 'lucide-react'
import { hubConfirmDropoff, hubLookup } from '../../services/handover'
import { Thumb } from '../../components/Thumb'
import { OrderTag } from '../../components/StatusTags'
import { FullPageSpinner } from '../../components/Guards'
import { messageOf } from '../../lib/errors'

type Lookup = Awaited<ReturnType<typeof hubLookup>> | null

// Opened by scanning the traveler's QR code at the hub.
export default function HubScanPage() {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<Lookup | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    hubLookup(token)
      .then(setInfo)
      .catch((e) => {
        setInfo(null)
        setError(messageOf(e))
      })
  }, [token])

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await hubConfirmDropoff(token)
      setDone(true)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  if (info === undefined) return <FullPageSpinner />

  return (
    <div className="mx-auto max-w-md space-y-4">
      {done ? (
        <section className="panel space-y-3 p-6 text-center">
          <CheckCircle2 className="mx-auto size-12 text-go" aria-hidden />
          <h1 className="text-3xl">Drop-off confirmed</h1>
          <p className="text-ink-soft">The traveler has been paid and the shopper was told the parcel is ready for pickup.</p>
          <Link to="/hub" className="btn btn-ink w-full">
            Back to the hub
          </Link>
        </section>
      ) : info ? (
        <section className="panel space-y-4 p-6">
          <p className="text-sm text-mist">Drop-off at {info.hub_name}</p>
          <div className="flex items-center gap-4">
            <Thumb src={info.image_url} className="size-20" />
            <div className="min-w-0 space-y-1">
              <h1 className="line-clamp-2 text-2xl">{info.title}</h1>
              <p className="truncate text-ink-soft">From {info.traveler_name ?? 'the traveler'}</p>
            </div>
          </div>
          <OrderTag status={info.status} />
          <p className="text-ink-soft">Check the parcel is the item in the order before confirming. Confirming pays the traveler.</p>
          {error && <p className="alert-error">{error}</p>}
          <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Confirming…' : 'Confirm drop-off'}
          </button>
        </section>
      ) : (
        <section className="panel space-y-3 p-6">
          <h1 className="text-2xl">Can't use this code</h1>
          <p className="alert-error">{error}</p>
          <Link to="/hub" className="btn btn-quiet">
            Back to the hub
          </Link>
        </section>
      )}
    </div>
  )
}
