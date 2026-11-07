import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../../auth/auth-context'
import { useLiveRefresh } from '../../notifications/notifications-context'
import { committedKg, getTrip, matchingOrders, setTripStatus } from '../../services/trips'
import { OrderRow } from '../../components/OrderRow'
import { FullPageSpinner } from '../../components/Guards'
import { VerifyNotice } from '../../components/VerifyNotice'
import { countryName, shortDate, todayIso } from '../../lib/places'
import { messageOf } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import type { Order, Trip } from '../../lib/database.types'

export default function TripPage() {
  const { tripId = '' } = useParams()
  const { user } = useAuth()
  const [trip, setTrip] = useState<Trip | null | undefined>(undefined)
  const [used, setUsed] = useState(0)
  const [matches, setMatches] = useState<Order[]>([])
  const [carrying, setCarrying] = useState<Order[]>([])
  const [offered, setOffered] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const t = await getTrip(tripId)
      setTrip(t)
      if (!t || !user) return
      const [kg, m, mine, offers] = await Promise.all([
        committedKg(t.id),
        t.status === 'OPEN' && t.travel_date >= todayIso() ? matchingOrders(t.id) : Promise.resolve([]),
        supabase.from('orders').select('*').eq('trip_id', t.id).neq('status', 'CANCELLED'),
        supabase.from('offers').select('order_id').eq('trip_id', t.id).eq('status', 'PENDING'),
      ])
      if (mine.error) throw mine.error
      if (offers.error) throw offers.error
      setUsed(kg)
      setMatches(m)
      setCarrying(mine.data)
      setOffered(new Set(offers.data.map((o) => o.order_id)))
      setError(null)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [tripId, user])

  useEffect(() => {
    void load()
  }, [load])
  useLiveRefresh(() => void load())

  if (trip === undefined && !error) return <FullPageSpinner />
  if (!trip) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <p className="panel p-6 text-ink-soft">{error ?? "This trip doesn't exist."}</p>
        <Link to="/trips" className="btn btn-quiet">
          Back to trips
        </Link>
      </div>
    )
  }

  const mine = trip.traveler_id === user?.id
  const open = trip.status === 'OPEN' && trip.travel_date >= todayIso()
  const left = Math.max(0, trip.capacity_kg - used)

  async function toggle(status: 'OPEN' | 'CLOSED') {
    setBusy(true)
    try {
      await setTripStatus(trip!.id, status)
      await load()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/trips" className="text-sm font-semibold text-ink-soft hover:text-ink">
        ← Trips
      </Link>

      <section className="rounded-xl bg-ink p-6 text-white">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-white/60">{shortDate(trip.travel_date)}</p>
            <h1 className="truncate text-4xl text-white">
              {trip.origin_city} <span className="text-signal">to</span> Beirut
            </h1>
            <p className="text-white/60">{countryName(trip.origin_country)}</p>
          </div>
          <div className="text-right">
            <p className="font-display text-4xl font-bold text-signal">{left} kg</p>
            <p className="text-white/60">
              free of {trip.capacity_kg} kg
            </p>
          </div>
        </div>
        {trip.notes && <p className="mt-4 border-t border-white/15 pt-3 text-white/75">{trip.notes}</p>}
      </section>

      {error && <p className="alert-error">{error}</p>}

      {carrying.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">Carrying on this trip</h2>
          <ul className="panel divide-y divide-line">
            {carrying.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
        </section>
      )}

      {mine && open && (
        <section className="space-y-3">
          <div>
            <h2 className="text-2xl">Orders on your route ({matches.length})</h2>
            <p className="text-ink-soft">
              Open orders from {countryName(trip.origin_country)} that fit in {left} kg and are needed after you land.
            </p>
          </div>
          <VerifyNotice action="make offers" />
          {matches.length === 0 ? (
            <p className="panel p-6 text-ink-soft">No matching orders yet. New ones appear here as shoppers post them.</p>
          ) : (
            <ul className="panel divide-y divide-line">
              {matches.map((o) => (
                <OrderRow key={o.id} order={o} note={offered.has(o.id) ? 'You made an offer' : `${o.weight_kg} kg. Tap to make an offer`} />
              ))}
            </ul>
          )}
        </section>
      )}

      {mine && trip.status !== 'CANCELLED' && trip.travel_date >= todayIso() && (
        <div>
          {trip.status === 'OPEN' ? (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void toggle('CLOSED')}>
              Stop taking orders
            </button>
          ) : (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void toggle('OPEN')}>
              Reopen for orders
            </button>
          )}
        </div>
      )}
    </div>
  )
}
