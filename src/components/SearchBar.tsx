import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Search } from 'lucide-react'
import { ORIGINS } from '../lib/places'
import { rememberCountry, rememberedCountry } from '../services/search'

/** Item + country search that opens /search. Used on the search page and the orders page. */
export function SearchBar({ initialQuery = '', initialCountry, autoFocus = false }: { initialQuery?: string; initialCountry?: string; autoFocus?: boolean }) {
  const navigate = useNavigate()
  const [q, setQ] = useState(initialQuery)
  const [country, setCountry] = useState(initialCountry ?? rememberedCountry())

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const query = q.trim()
    if (query.length < 2) return
    rememberCountry(country)
    navigate(`/search?q=${encodeURIComponent(query)}&country=${country}`)
  }

  return (
    <form onSubmit={onSubmit} role="search" className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
      <label className="relative">
        <span className="sr-only">What are you looking for?</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-mist" aria-hidden />
        <input
          className="input h-12 pl-10 text-[17px]"
          type="search"
          enterKeyHint="search"
          placeholder="AirPods, Nike Air Max 90, Dyson…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus={autoFocus}
        />
      </label>
      <div className="grid grid-cols-[1fr_auto] gap-2 sm:contents">
        <select aria-label="Country to search in" className="input h-12" value={country} onChange={(e) => setCountry(e.target.value)}>
          {ORIGINS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary h-12" disabled={q.trim().length < 2}>
          Search
        </button>
      </div>
    </form>
  )
}
