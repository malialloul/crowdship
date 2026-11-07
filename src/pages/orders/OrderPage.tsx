import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { ExternalLink, Plane } from 'lucide-react'
import { Thumb } from '../../components/Thumb'
import { useAuth } from '../../auth/auth-context'
import { useLiveRefresh } from '../../notifications/notifications-context'
import {
  cancelOrder,
  fetchPublicProfiles,
  getOrder,
  listOfferEvents,
  listOffersForOrder,
  listTripsByIds,
  makeOffer,
  respondOffer,
} from '../../services/orders'
import { committedKg, eligibleTrips } from '../../services/trips'
import { fetchSettings, listHubs, shopperFee } from '../../services/handover'
import {
  EnterCodePanel,
  HandoverCodePanel,
  HubAddress,
  HubQrPanel,
  Panel,
  ProofReviewPanel,
  ProofSentPanel,
  ProofUploadPanel,
  useProofs,
} from './HandoverPanels'
import { getEscrowForOrder, startPaymentHold } from '../../services/escrow'
import { MoneyBreakdown, splitAmounts, splitFromEscrow, type Split } from '../../components/MoneyBreakdown'
import { OrderTag } from '../../components/StatusTags'
import { VerifyNotice } from '../../components/VerifyNotice'
import { FullPageSpinner } from '../../components/Guards'
import { countryName, shortDate, todayIso } from '../../lib/places'
import { messageOf } from '../../lib/errors'
import { dateTime, money } from '../../lib/format'
import type { AppSettings, Currency, HandoverMethod, Hub, Offer, OfferEvent, Order, PublicProfile, Trip } from '../../lib/database.types'

type Party = 'shopper' | 'traveler'

function amountOk(v: string, currency: Currency): number | null {
  const n = Number(v.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return currency === 'LBP' ? Math.round(n) : Math.round(n * 100) / 100
}

// ---------------------------------------------------------------- pieces

function handoverLabel(method: HandoverMethod | null, hub: Hub | undefined): string {
  return method === 'hub' ? `Hub drop-off${hub ? `, ${hub.name}` : ''}` : 'In person'
}

function OrderSummary({ order, hub }: { order: Order; hub: Hub | undefined }) {
  const rows: [string, string][] = [
    ['Item', `${money(order.item_price, order.currency)}${order.quantity > 1 ? ` × ${order.quantity}` : ''}`],
    [order.agreed_reward != null ? 'Agreed reward' : 'Offered reward', money(order.agreed_reward ?? order.reward_amount, order.currency)],
    ['Ships from', countryName(order.origin_country)],
    ['Weight', order.weight_kg != null ? `${order.weight_kg} kg` : 'Set by the traveler'],
  ]
  if (order.needed_by) rows.push(['Needed by', shortDate(order.needed_by)])
  if (order.handover) rows.push(['Handover', handoverLabel(order.handover, hub)])

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-5 p-6 sm:flex-row">
        <Thumb src={order.image_url} className="size-28 rounded-lg" iconClass="size-10" />
        <div className="min-w-0 flex-1 space-y-3">
          <OrderTag status={order.status} />
          <h1 className="text-3xl sm:text-4xl">{order.title}</h1>
          {order.item_url && (
            <a
              href={order.item_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-sm font-semibold underline underline-offset-4"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="truncate">{new URL(order.item_url).hostname.replace(/^www\./, '')}</span>
            </a>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line px-6 py-4 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className={`min-w-0 ${k === 'Handover' ? 'col-span-2 sm:col-span-1' : ''}`}>
            <dt className="text-sm text-mist">{k}</dt>
            <dd className="truncate font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {order.description && <p className="border-t border-line px-6 py-4 whitespace-pre-line text-ink-soft">{order.description}</p>}
    </section>
  )
}

function History({ events, currency, viewer }: { events: OfferEvent[]; currency: Currency; viewer: Party }) {
  if (events.length <= 1) return null
  const verb: Record<string, string> = {
    offer: 'offered',
    counter: 'countered with',
    accept: 'accepted',
    decline: 'declined',
    withdraw: 'withdrew',
  }
  return (
    <ol className="space-y-1 border-l-2 border-line pl-3 text-sm text-ink-soft">
      {events.map((e) => (
        <li key={e.id}>
          <span className="font-semibold capitalize text-ink">{e.actor === viewer ? 'You' : (e.actor ?? 'System')}</span>{' '}
          {verb[e.action] ?? e.action}
          {e.amount != null && e.action !== 'accept' ? ` ${money(e.amount, currency)}` : ''}
          <span className="ml-2 text-mist">{dateTime(e.created_at)}</span>
        </li>
      ))}
    </ol>
  )
}

function OfferCard({
  offer,
  order,
  trip,
  traveler,
  events,
  viewer,
  hubs,
  onChanged,
}: {
  offer: Offer
  order: Order
  trip: Trip | undefined
  traveler: PublicProfile | undefined
  events: OfferEvent[]
  viewer: Party
  hubs: Map<string, Hub>
  onChanged: () => void
}) {
  const [countering, setCountering] = useState(false)
  const [amount, setAmount] = useState(String(offer.amount))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const live = offer.status === 'PENDING' && order.status === 'SEARCHING_TRAVELER'
  const myTurn = live && offer.awaiting === viewer
  const canWithdrawAccepted =
    viewer === 'traveler' && offer.status === 'ACCEPTED' && order.status === 'AWAITING_PAYMENT_HOLD'

  async function act(action: 'accept' | 'counter' | 'decline' | 'withdraw') {
    setError(null)
    let value: number | undefined
    if (action === 'counter') {
      const v = amountOk(amount, order.currency)
      if (v === null) return setError('Enter a valid amount')
      value = v
    }
    setBusy(true)
    try {
      await respondOffer(offer.id, action, value)
      setCountering(false)
      onChanged()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const statusLine =
    offer.status === 'ACCEPTED'
      ? 'Accepted'
      : offer.status === 'DECLINED'
        ? 'Declined'
        : offer.status === 'WITHDRAWN'
          ? 'Withdrawn'
          : myTurn
            ? 'Your move'
            : viewer === 'shopper'
              ? 'Waiting for the traveler'
              : 'Waiting for the shopper'

  return (
    <article className={`panel space-y-4 p-5 ${offer.status === 'PENDING' || offer.status === 'ACCEPTED' ? '' : 'opacity-70'}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {viewer === 'shopper' && (
            <p className="flex min-w-0 items-center gap-2 text-[17px] font-semibold">
              <span className="truncate">{traveler?.display_name ?? 'Traveler'}</span>
              {traveler?.verified && <span className="tag bg-go text-white">Verified</span>}
            </p>
          )}
          {trip && (
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink-soft">
              <Plane className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {trip.origin_city} to Beirut, {shortDate(trip.travel_date)}
              </span>
            </p>
          )}
          <p className="truncate text-sm text-ink-soft">
            {offer.weight_kg != null ? `${offer.weight_kg} kg, ` : ''}
            {handoverLabel(offer.handover, offer.hub_id ? hubs.get(offer.hub_id) : undefined)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-3xl font-bold whitespace-nowrap">{money(offer.amount, order.currency)}</p>
          <p className={`text-sm font-semibold whitespace-nowrap ${myTurn ? 'text-ink' : 'text-mist'}`}>{statusLine}</p>
        </div>
      </header>

      {offer.message && <p className="rounded-md bg-paper px-3 py-2 text-[15px]">“{offer.message}”</p>}
      <History events={events} currency={order.currency} viewer={viewer} />

      {error && <p className="alert-error">{error}</p>}

      {myTurn && !countering && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act('accept')}>
            Accept {money(offer.amount, order.currency)}
          </button>
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setCountering(true)}>
            Counter-offer
          </button>
          {viewer === 'shopper' && (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void act('decline')}>
              Decline
            </button>
          )}
        </div>
      )}

      {myTurn && countering && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`counter-${offer.id}`} className="field-label">
              Your amount ({order.currency})
            </label>
            <input
              id={`counter-${offer.id}`}
              className="input w-36"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>
          <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void act('counter')}>
            Send counter-offer
          </button>
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setCountering(false)}>
            Cancel
          </button>
        </div>
      )}

      {viewer === 'traveler' && (live || canWithdrawAccepted) && (
        <button
          type="button"
          className="text-sm font-semibold text-stop underline underline-offset-4 disabled:opacity-50"
          disabled={busy}
          onClick={() => void act('withdraw')}
        >
          Withdraw my offer
        </button>
      )}
    </article>
  )
}

function MakeOfferForm({ order, trips, hubs, onDone }: { order: Order; trips: Trip[]; hubs: Hub[]; onDone: () => void }) {
  const { profile } = useAuth()
  // Trips load after the first render, so fall back to the first one until the user picks.
  const [pickedTripId, setTripId] = useState<string | null>(null)
  const tripId = trips.some((t) => t.id === pickedTripId) ? pickedTripId! : (trips[0]?.id ?? '')
  const trip = trips.find((t) => t.id === tripId)
  const [amount, setAmount] = useState(String(order.reward_amount))
  const [weight, setWeight] = useState('')
  const [handover, setHandover] = useState<HandoverMethod>('in_person')
  const [pickedHub, setHub] = useState<string | null>(null)
  const hubId = hubs.some((h) => h.id === pickedHub) ? pickedHub! : (hubs[0]?.id ?? null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usedKg, setUsedKg] = useState<number | null>(null)

  useEffect(() => {
    if (!tripId) return
    setUsedKg(null)
    committedKg(tripId).then(setUsedKg).catch(() => setUsedKg(null))
  }, [tripId])
  const leftKg = trip && usedKg != null ? Math.max(0, Math.round((trip.capacity_kg - usedKg) * 10) / 10) : null

  if (trips.length === 0) {
    return (
      <section className="panel space-y-3 p-6">
        <h2 className="text-2xl">Want to bring this?</h2>
        <p className="text-ink-soft">
          Add your trip from {countryName(order.origin_country)} to Beirut
          {order.needed_by ? `, landing by ${shortDate(order.needed_by)},` : ''} and you can make an offer.
        </p>
        <Link to={`/trips/new?country=${order.origin_country}`} className="btn btn-ink">
          Add a trip
        </Link>
      </section>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const v = amountOk(amount, order.currency)
    if (v === null) return setError('Enter a valid reward')
    if (!tripId) return setError('Choose your trip')
    const kg = Number(weight.replace(',', '.'))
    if (!(kg > 0 && kg <= 32)) return setError('Enter the weight in kg (up to 32)')
    if (leftKg != null && kg > leftKg) return setError(`Only ${leftKg} kg left on this trip`)
    if (handover === 'hub' && !hubId) return setError('Choose a drop-off hub')
    setBusy(true)
    setError(null)
    try {
      await makeOffer({ orderId: order.id, tripId, amount: v, weightKg: Math.round(kg * 100) / 100, handover, hubId, message })
      onDone()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel space-y-4 p-6" noValidate>
      <div>
        <h2 className="text-2xl">Offer to bring it</h2>
        <p className="mt-1 text-ink-soft">
          The shopper offers {money(order.reward_amount, order.currency)}. Keep it, or ask for a different reward.
        </p>
      </div>
      <VerifyNotice action="make offers" />
      <div>
        <label htmlFor="trip" className="field-label">
          Your trip
        </label>
        <select id="trip" className="input" value={tripId} onChange={(e) => setTripId(e.target.value)}>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.origin_city} to Beirut, {shortDate(t.travel_date)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="weight" className="field-label">
          Weight with packaging (kg)
        </label>
        <input id="weight" className="input w-40" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.5" />
        <p className="field-hint">{leftKg != null ? `${leftKg} kg left on this trip. ` : ''}This comes off your luggage space once the shopper accepts.</p>
      </div>
      <fieldset>
        <legend className="field-label">Handover in Lebanon</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['in_person', 'In person'],
              ['hub', 'Hub drop-off'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`flex h-11 cursor-pointer items-center justify-center rounded-md border text-[15px] font-semibold whitespace-nowrap ${
                handover === value ? 'border-ink bg-ink text-white' : 'border-line bg-card text-ink-soft'
              } ${value === 'hub' && hubs.length === 0 ? 'pointer-events-none opacity-40' : ''}`}
            >
              <input type="radio" name="handover" value={value} checked={handover === value} onChange={() => setHandover(value)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
        <p className="field-hint">
          {handover === 'hub' ? "Leave it at a hub; you're paid when the staff scan your QR code." : 'Meet the shopper; you\'re paid when they give you their code.'}
        </p>
      </fieldset>
      {handover === 'hub' && hubs.length > 0 && (
        <div>
          <label htmlFor="hub" className="field-label">
            Hub
          </label>
          <select id="hub" className="input" value={hubId ?? ''} onChange={(e) => setHub(e.target.value)}>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}, {h.area}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="amount" className="field-label">
            Your reward ({order.currency})
          </label>
          <input id="amount" className="input w-40" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        {Number(amount) !== order.reward_amount && (
          <button type="button" className="mb-2.5 text-sm font-semibold underline underline-offset-4" onClick={() => setAmount(String(order.reward_amount))}>
            Use the shopper's {money(order.reward_amount, order.currency)}
          </button>
        )}
      </div>
      <div>
        <label htmlFor="msg" className="field-label">
          Message <span className="font-normal text-mist">(optional)</span>
        </label>
        <input id="msg" className="input" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="I land Friday evening and can meet in Achrafieh" />
      </div>
      {error && <p className="alert-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy || profile?.kyc_status !== 'verified'}>
        {busy ? 'Sending…' : 'Send offer'}
      </button>
    </form>
  )
}

function PayPanel({ order, settings }: { order: Order; settings: AppSettings | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const split: Split = {
    item: order.item_total,
    reward: order.agreed_reward ?? 0,
    fee: shopperFee(settings, order.currency),
    feePayer: 'shopper',
    currency: order.currency,
  }
  const total = splitAmounts(split).shopperPays

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      const hold = await startPaymentHold(order.id)
      window.location.assign(hold.collect_url)
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl bg-ink p-6 text-white">
      <h2 className="text-2xl text-white">Pay into escrow to lock the deal</h2>
      <MoneyBreakdown split={split} viewer="shopper" tone="dark" />
      <p className="text-white/75">Whish holds it. The traveler is paid only after you receive the item.</p>
      {error && <p className="rounded-md bg-stop-wash px-3 py-2 text-sm text-stop">{error}</p>}
      <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={() => void pay()}>
        {busy ? 'Opening Whish…' : `Pay ${money(total, order.currency)} with Whish`}
      </button>
    </section>
  )
}

/** The traveler's cut of a held or released payment, read from the escrow itself. */
function TravelerPayout({ order, version, released, inset = false }: { order: Order; version: string; released: boolean; inset?: boolean }) {
  const [escrow, setEscrow] = useState<Awaited<ReturnType<typeof getEscrowForOrder>>>(null)
  useEffect(() => {
    getEscrowForOrder(order.id)
      .then(setEscrow)
      .catch(() => setEscrow(null))
  }, [order.id, version])
  if (!escrow || (escrow.status !== 'HELD' && escrow.status !== 'RELEASED')) return null
  return (
    <div className={inset ? 'rounded-md bg-paper p-3' : 'panel p-5'}>
      <p className="mb-1 text-sm font-semibold text-ink-soft">{released ? 'Your payout' : 'What you get on delivery'}</p>
      <MoneyBreakdown split={splitFromEscrow(escrow)} viewer="traveler" />
    </div>
  )
}

// What each side sees at each stage, from payment to handover.
function StatusPanels({
  order,
  isShopper,
  isMyDelivery,
  trip,
  hub,
  viaHub,
  settings,
  version,
  onChanged,
}: {
  order: Order
  isShopper: boolean
  isMyDelivery: boolean
  trip: Trip | undefined
  hub: Hub | undefined
  viaHub: boolean
  settings: AppSettings | null
  version: string
  onChanged: () => void
}) {
  const showProofs = (isShopper || isMyDelivery) && order.status === 'PURCHASING' && order.proof_status === 'submitted'
  const proofs = useProofs(order.id, showProofs, version)

  if (order.status === 'AWAITING_PAYMENT_HOLD') {
    if (isShopper) return <PayPanel order={order} settings={settings} />
    if (isMyDelivery)
      return (
        <Panel title="Deal agreed. Wait for payment">
          <p>Don't buy the item yet. You'll get a notification as soon as the shopper's money is held in escrow.</p>
        </Panel>
      )
  }

  if (order.status === 'PURCHASING') {
    if (isMyDelivery) {
      return (
        <div className="space-y-4">
          {order.proof_status === 'submitted' ? <ProofSentPanel proofs={proofs} /> : <ProofUploadPanel order={order} trip={trip} onDone={onChanged} />}
          <TravelerPayout order={order} version={version} released={false} />
        </div>
      )
    }
    if (isShopper) {
      if (order.proof_status === 'submitted') return <ProofReviewPanel order={order} proofs={proofs} onDone={onChanged} />
      return (
        <Panel title="Payment held. The traveler is buying your item">
          <p>
            {order.proof_status === 'rejected'
              ? "You asked for new photos. We'll notify you when the traveler sends them."
              : "You'll get photos of the item and the receipt to check before they fly."}
          </p>
        </Panel>
      )
    }
  }

  if (order.status === 'IN_TRANSIT') {
    if (isShopper) {
      if (viaHub)
        return (
          <Panel title="On the way to the hub">
            <p>The traveler will leave it here. We'll notify you when it's ready to pick up.</p>
            {hub && <HubAddress hub={hub} />}
          </Panel>
        )
      return <HandoverCodePanel order={order} version={version} />
    }
    if (isMyDelivery)
      return (
        <div className="space-y-4">
          {viaHub ? <HubQrPanel order={order} hub={hub} version={version} /> : <EnterCodePanel order={order} onDone={onChanged} />}
          <TravelerPayout order={order} version={version} released={false} />
        </div>
      )
  }

  if (order.status === 'DELIVERED') {
    if (order.delivered_via === 'hub' && isShopper)
      return (
        <Panel title="Ready for pickup" tone="ok">
          <p>Your item is waiting at the hub. Bring your ID.</p>
          {hub && <HubAddress hub={hub} />}
        </Panel>
      )
    return (
      <Panel title="Delivered" tone="ok">
        <p>{isMyDelivery ? 'Your payment is on its way to your Whish account.' : 'The handover is done and the traveler has been paid.'}</p>
        {isMyDelivery && <TravelerPayout order={order} version={version} released inset />}
      </Panel>
    )
  }

  if (order.status === 'CANCELLED')
    return (
      <Panel title="Cancelled">
        <p>This order is closed.</p>
      </Panel>
    )

  return null
}

// ---------------------------------------------------------------- page

export default function OrderPage() {
  const { orderId = '' } = useParams()
  const { user } = useAuth()
  const [order, setOrder] = useState<Order | null | undefined>(undefined)
  const [offers, setOffers] = useState<Offer[]>([])
  const [trips, setTrips] = useState<Map<string, Trip>>(new Map())
  const [events, setEvents] = useState<OfferEvent[]>([])
  const [people, setPeople] = useState<Map<string, PublicProfile>>(new Map())
  const [myTrips, setMyTrips] = useState<Trip[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [hubs, setHubs] = useState<Hub[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const o = await getOrder(orderId)
      setOrder(o)
      if (!o) return
      const offs = await listOffersForOrder(o.id)
      const [ts, evs, ppl, hs, st] = await Promise.all([
        listTripsByIds([...new Set([...offs.map((x) => x.trip_id), ...(o.trip_id ? [o.trip_id] : [])])]),
        listOfferEvents(offs.map((x) => x.id)),
        fetchPublicProfiles([...offs.map((x) => x.traveler_id), o.shopper_id]),
        listHubs().catch(() => [] as Hub[]),
        fetchSettings().catch(() => null),
      ])
      setHubs(hs)
      setSettings(st)
      setOffers(offs)
      setTrips(new Map(ts.map((t) => [t.id, t])))
      setEvents(evs)
      setPeople(ppl)
      if (o.shopper_id !== user.id && o.status === 'SEARCHING_TRAVELER') {
        setMyTrips(await eligibleTrips(user.id, o, todayIso()))
      }
      setError(null)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [orderId, user])

  useEffect(() => {
    void load()
  }, [load])
  useLiveRefresh(() => void load())

  if (order === undefined && !error) return <FullPageSpinner />
  if (!order || !user) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <p className="panel p-6 text-ink-soft">{error ?? "This order doesn't exist or isn't visible to you."}</p>
        <Link to="/orders" className="btn btn-quiet">
          Back to orders
        </Link>
      </div>
    )
  }

  const isShopper = order.shopper_id === user.id
  const viewer: Party = isShopper ? 'shopper' : 'traveler'
  const visibleOffers = isShopper ? offers : offers.filter((o) => o.traveler_id === user.id)
  const liveOffers = visibleOffers.filter((o) => o.status === 'PENDING' || o.status === 'ACCEPTED')
  const pastOffers = visibleOffers.filter((o) => o.status !== 'PENDING' && o.status !== 'ACCEPTED')
  const hasLiveOwnOffer = !isShopper && offers.some((o) => o.traveler_id === user.id && o.status === 'PENDING')
  const isMyDelivery = order.traveler_id === user.id
  const shopperName = people.get(order.shopper_id)?.display_name
  const hubMap = new Map(hubs.map((h) => [h.id, h]))
  const orderHub = order.hub_id ? hubMap.get(order.hub_id) : undefined
  const viaHub = order.handover === 'hub'
  const version = `${order.updated_at}|${order.proof_status}|${order.status}`

  async function cancel() {
    if (!order) return
    setCancelling(true)
    try {
      await cancelOrder(order.id)
      await load()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setCancelling(false)
    }
  }

  const card = (o: Offer) => (
    <OfferCard
      key={o.id}
      offer={o}
      order={order}
      trip={trips.get(o.trip_id)}
      traveler={people.get(o.traveler_id)}
      events={events.filter((e) => e.offer_id === o.id)}
      viewer={viewer}
      hubs={hubMap}
      onChanged={() => void load()}
    />
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={isShopper || isMyDelivery ? '/orders' : '/trips'} className="text-sm font-semibold text-ink-soft hover:text-ink">
        ← {isShopper || isMyDelivery ? 'Orders' : 'Trips'}
      </Link>

      <OrderSummary order={order} hub={orderHub} />
      {!isShopper && shopperName && <p className="text-sm text-ink-soft">Posted by {shopperName}</p>}
      {error && <p className="alert-error">{error}</p>}

      <StatusPanels
        order={order}
        isShopper={isShopper}
        isMyDelivery={isMyDelivery}
        trip={order.trip_id ? trips.get(order.trip_id) : undefined}
        hub={orderHub}
        viaHub={viaHub}
        settings={settings}
        version={version}
        onChanged={() => void load()}
      />

      {/* Offers */}
      {(liveOffers.length > 0 || (isShopper && order.status === 'SEARCHING_TRAVELER')) && (
        <section className="space-y-3">
          <h2 className="text-2xl">
            {!isShopper ? 'Your offer' : order.status === 'SEARCHING_TRAVELER' ? `Offers (${liveOffers.length})` : 'Accepted offer'}
          </h2>
          {liveOffers.length === 0 ? (
            <p className="panel p-6 text-ink-soft">
              No offers yet. Travelers flying from {countryName(order.origin_country)} see your order and can make one.
            </p>
          ) : (
            liveOffers.map(card)
          )}
        </section>
      )}

      {!isShopper && order.status === 'SEARCHING_TRAVELER' && !hasLiveOwnOffer && (
        <MakeOfferForm order={order} trips={myTrips} hubs={hubs} onDone={() => void load()} />
      )}

      {pastOffers.length > 0 && (
        <details className="space-y-3">
          <summary className="cursor-pointer text-[15px] font-semibold text-ink-soft">Closed offers ({pastOffers.length})</summary>
          <div className="mt-3 space-y-3">{pastOffers.map(card)}</div>
        </details>
      )}

      {isShopper && (order.status === 'SEARCHING_TRAVELER' || order.status === 'AWAITING_PAYMENT_HOLD') &&
        (confirmCancel ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-stop-wash p-3">
            <p className="text-[15px] text-stop">Cancel this order? Open offers will be closed.</p>
            <button type="button" className="btn btn-danger h-9 text-sm" disabled={cancelling} onClick={() => void cancel()}>
              {cancelling ? 'Cancelling…' : 'Yes, cancel order'}
            </button>
            <button type="button" className="btn btn-quiet h-9 text-sm" disabled={cancelling} onClick={() => setConfirmCancel(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="text-sm font-semibold text-stop underline underline-offset-4"
            onClick={() => setConfirmCancel(true)}
          >
            Cancel this order
          </button>
        ))}
    </div>
  )
}
