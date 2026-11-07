import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../../auth/auth-context'
import { createTrip } from '../../services/trips'
import { VerifyNotice } from '../../components/VerifyNotice'
import { ORIGINS, todayIso } from '../../lib/places'
import { messageOf } from '../../lib/errors'

export default function NewTripPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preset = params.get('country')

  const [country, setCountry] = useState(ORIGINS.some((o) => o.code === preset) ? preset! : '')
  const [city, setCity] = useState('')
  const [date, setDate] = useState('')
  const [capacity, setCapacity] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cities = ORIGINS.find((o) => o.code === country)?.cities ?? []

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const kg = Number(capacity.replace(',', '.'))
    if (!country) return setError('Choose the country you fly from')
    if (city.trim().length < 2) return setError('Enter the city you fly from')
    if (!date) return setError('Choose your travel date')
    if (!(kg > 0 && kg <= 50)) return setError('Space for orders must be between 0.5 and 50 kg')

    setBusy(true)
    try {
      const trip = await createTrip({
        origin_country: country,
        origin_city: city.trim(),
        travel_date: date,
        capacity_kg: Math.round(kg * 10) / 10,
        notes: notes.trim() || null,
      })
      navigate(`/trips/${trip.id}`, { replace: true })
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-4xl">Add a trip</h1>
        <p className="mt-1 text-ink-soft">We'll show you orders on your route that fit in your luggage.</p>
      </div>

      <VerifyNotice action="add trips" />

      <form onSubmit={onSubmit} className="panel space-y-5 p-6" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="country" className="field-label">
              Flying from
            </label>
            <select
              id="country"
              className="input"
              value={country}
              onChange={(e) => {
                setCountry(e.target.value)
                setCity('')
              }}
            >
              <option value="" disabled>
                Choose a country
              </option>
              {ORIGINS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="city" className="field-label">
              City
            </label>
            <input id="city" className="input" list="city-options" value={city} onChange={(e) => setCity(e.target.value)} placeholder={cities[0] ?? 'City'} />
            <datalist id="city-options">
              {cities.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <p className="field-label">Flying to</p>
          <p className="flex h-11 items-center rounded-md border border-line bg-paper px-3 text-ink-soft">Beirut (BEY)</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="date" className="field-label">
              Landing date
            </label>
            <input id="date" className="input" type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="kg" className="field-label">
              Space for orders (kg)
            </label>
            <input id="kg" className="input" inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="5" />
          </div>
        </div>

        <div>
          <label htmlFor="notes" className="field-label">
            Notes for shoppers <span className="font-normal text-mist">(optional)</span>
          </label>
          <input id="notes" className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="No liquids or electronics over 1 kg" />
        </div>

        {error && <p className="alert-error" role="alert">{error}</p>}

        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={busy || profile?.kyc_status !== 'verified'}>
          {busy ? 'Saving…' : 'Add trip'}
        </button>
      </form>
    </div>
  )
}
