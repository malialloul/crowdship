import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { useLiveRefresh } from '../../notifications/notifications-context'
import { listMyTrips, tripActivity, type TripActivity } from '../../services/trips'
import { countryName, shortDate, todayIso } from '../../lib/places'
import { messageOf } from '../../lib/errors'
import type { Trip } from '../../lib/database.types'

function TripRow({ trip, activity }: { trip: Trip; activity?: TripActivity }) {
  const past = trip.travel_date < todayIso()
  const open = trip.status === 'OPEN' && !past
  const label = trip.status !== 'OPEN' ? (trip.status === 'CLOSED' ? 'Closed' : 'Cancelled') : past ? 'Landed' : 'Open for orders'
  const waiting = activity?.waiting ?? 0
  const hot = open && waiting > 0
  const [day, month] = shortDate(trip.travel_date).split(' ')

  const details: string[] = []
  if (activity?.carrying) details.push(`Carrying ${activity.carrying}`)
  if (activity?.offered) details.push(`${activity.offered} offer${activity.offered > 1 ? 's' : ''} sent`)

  return (
    <li>
      <Link
        to={`/trips/${trip.id}`}
        className={`flex items-center gap-4 border-l-4 px-5 py-4 ${
          hot ? 'border-l-signal-deep bg-signal-wash hover:bg-signal/30' : 'border-l-transparent hover:bg-paper'
        }`}
      >
        <div className="w-14 shrink-0 text-center">
          <p className="font-display text-2xl leading-none font-bold">{day}</p>
          <p className="text-sm text-mist">{month}</p>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-display text-xl font-semibold">
            {trip.origin_city} <span className="text-mist">to</span> Beirut
          </p>
          <p className="truncate text-sm text-ink-soft">
            {countryName(trip.origin_country)}, {trip.capacity_kg} kg of space
          </p>
          {details.length > 0 && <p className="truncate text-sm font-semibold text-ink">{details.join(', ')}</p>}
        </div>
        {hot ? (
          <span className="flex shrink-0 flex-col items-center rounded-lg bg-ink px-3 py-1.5 text-center text-white">
            <span className="font-display text-2xl leading-none font-bold text-signal">{waiting}</span>
            <span className="text-xs">{waiting === 1 ? 'order waiting' : 'orders waiting'}</span>
          </span>
        ) : (
          <span className="tag shrink-0 bg-line text-ink-soft">
            {open ? 'No orders yet' : label}
          </span>
        )}
      </Link>
    </li>
  )
}

export default function TripsPage() {
  const { user } = useAuth()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [activity, setActivity] = useState<Map<string, TripActivity>>(new Map())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const ts = await listMyTrips(user.id)
      setTrips(ts)
      setActivity(await tripActivity(ts, todayIso()))
    } catch (err) {
      setError(messageOf(err))
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])
  useLiveRefresh(() => void load())

  const today = todayIso()
  const upcoming = (trips?.filter((t) => t.travel_date >= today && t.status === 'OPEN') ?? []).sort(
    (a, b) => (activity.get(b.id)?.waiting ?? 0) - (activity.get(a.id)?.waiting ?? 0) || a.travel_date.localeCompare(b.travel_date),
  )
  const other = trips?.filter((t) => !(t.travel_date >= today && t.status === 'OPEN')) ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl">Trips</h1>
          <p className="mt-1 text-ink-soft">Flying to Beirut? Carry orders in your spare luggage and earn the reward.</p>
        </div>
        <Link to="/trips/new" className="btn btn-primary">
          <Plus className="size-4" aria-hidden />
          Add a trip
        </Link>
      </div>

      {error && <p className="alert-error">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-2xl">Upcoming</h2>
        <div className="panel">
          {trips === null ? (
            <p className="p-6 text-mist">Loading…</p>
          ) : upcoming.length === 0 ? (
            <div className="space-y-3 p-6">
              <p className="text-ink-soft">Add your next flight to see orders waiting on your route.</p>
              <Link to="/trips/new" className="btn btn-quiet">
                Add a trip
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((t) => (
                <TripRow key={t.id} trip={t} activity={activity.get(t.id)} />
              ))}
            </ul>
          )}
        </div>
      </section>

      {other.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">Past and closed</h2>
          <ul className="panel divide-y divide-line">
            {other.map((t) => (
              <TripRow key={t.id} trip={t} activity={activity.get(t.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
