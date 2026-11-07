import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { listMyTrips } from '../../services/trips'
import { countryName, shortDate, todayIso } from '../../lib/places'
import { messageOf } from '../../lib/errors'
import type { Trip } from '../../lib/database.types'

function TripRow({ trip }: { trip: Trip }) {
  const past = trip.travel_date < todayIso()
  const label = trip.status !== 'OPEN' ? (trip.status === 'CLOSED' ? 'Closed' : 'Cancelled') : past ? 'Landed' : 'Open for orders'
  return (
    <li>
      <Link to={`/trips/${trip.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-paper">
        <div className="w-16 shrink-0 text-center">
          <p className="font-display text-2xl leading-none font-bold">{shortDate(trip.travel_date).split(' ')[0]}</p>
          <p className="text-sm text-mist">{shortDate(trip.travel_date).split(' ')[1]}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-semibold">
            {trip.origin_city} <span className="text-mist">to</span> Beirut
          </p>
          <p className="text-sm text-ink-soft">
            {countryName(trip.origin_country)}, {trip.capacity_kg} kg of space
          </p>
        </div>
        <span className={`tag ${trip.status === 'OPEN' && !past ? 'bg-signal text-ink' : 'bg-line text-ink-soft'}`}>{label}</span>
      </Link>
    </li>
  )
}

export default function TripsPage() {
  const { user } = useAuth()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    try {
      setTrips(await listMyTrips(user.id))
    } catch (err) {
      setError(messageOf(err))
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const today = todayIso()
  const upcoming = trips?.filter((t) => t.travel_date >= today && t.status === 'OPEN') ?? []
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
                <TripRow key={t.id} trip={t} />
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
              <TripRow key={t.id} trip={t} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
