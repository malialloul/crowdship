import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ExternalLink, Globe, MapPin, Search, Star, Store as StoreIcon } from 'lucide-react'
import { Thumb } from '../components/Thumb'
import { SearchBar } from '../components/SearchBar'
import { searchProducts, type OrderPrefill, type SearchResult, type ShopOption, type Store } from '../services/search'
import { countryName, ORIGINS } from '../lib/places'
import { messageOf } from '../lib/errors'

function OptionCard({ o, country, query }: { o: ShopOption; country: string; query: string }) {
  const navigate = useNavigate()

  function request() {
    const prefill: OrderPrefill = {
      url: o.item_url,
      title: o.item_title || query,
      image_url: o.image_url,
      country,
      price: o.price,
      currency: o.currency,
      price_label: o.price_label,
      shop: o.shop,
    }
    navigate('/orders/new', { state: { prefill } })
  }

  return (
    <li className="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 gap-4">
        <Thumb src={o.image_url} className="size-16" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[17px] font-semibold">{o.shop}</p>
            {o.price_label && <p className="shrink-0 font-display text-xl font-bold whitespace-nowrap">{o.price_label}</p>}
          </div>
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink-soft">
            {o.address ? (
              <>
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{o.address}</span>
              </>
            ) : (
              <>
                <Globe className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">Online shop, {new URL(o.website).hostname.replace(/^www\./, '')}</span>
              </>
            )}
            {o.rating != null && (
              <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 text-mist">
                <Star className="size-3.5" aria-hidden />
                {o.rating.toFixed(1)}
              </span>
            )}
          </p>
          <p className="line-clamp-2 text-[15px]">{o.item_title}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:w-44 sm:grid-cols-1">
        <button type="button" className="btn btn-primary col-span-2 h-10 sm:col-span-1" onClick={request}>
          Request this
        </button>
        <a href={o.item_url} target="_blank" rel="noreferrer noopener" className="btn btn-quiet h-10 text-sm">
          <ExternalLink className="size-4" aria-hidden />
          Open item
        </a>
        <a href={o.website} target="_blank" rel="noreferrer noopener" className="btn btn-quiet h-10 text-sm">
          <Globe className="size-4" aria-hidden />
          View website
        </a>
      </div>
    </li>
  )
}

function StoreRow({ s }: { s: Store }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{s.shop}</p>
        {s.address && (
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink-soft">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{s.address}</span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {s.search_url && (
          <a href={s.search_url} target="_blank" rel="noreferrer noopener" className="btn btn-quiet h-9 text-sm">
            <Search className="size-4" aria-hidden />
            Find the item
          </a>
        )}
        {s.website && (
          <a href={s.website} target="_blank" rel="noreferrer noopener" className="btn btn-quiet h-9 text-sm">
            <Globe className="size-4" aria-hidden />
            View website
          </a>
        )}
        {s.maps_url && (
          <a href={s.maps_url} target="_blank" rel="noreferrer noopener" className="btn btn-quiet h-9 text-sm">
            <MapPin className="size-4" aria-hidden />
            Map
          </a>
        )}
      </div>
    </li>
  )
}

export default function SearchPage() {
  const [params] = useSearchParams()
  const q = params.get('q')?.trim() ?? ''
  const country = ORIGINS.some((o) => o.code === params.get('country')) ? params.get('country')! : ''
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (q.length < 2 || !country) return
    let active = true
    setLoading(true)
    setError(null)
    setResult(null)
    searchProducts(q, country)
      .then((r) => active && setResult(r))
      .catch((e) => active && setError(messageOf(e)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [q, country])

  const where = countryName(country)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-4xl">Find it abroad</h1>
        <p className="mt-1 text-ink-soft">Search shops in another country, then ask a traveler to bring it.</p>
      </div>

      <SearchBar key={`${q}|${country}`} initialQuery={q} initialCountry={country || undefined} autoFocus={!q} />

      {error && <p className="alert-error">{error}</p>}

      {loading && (
        <ul className="space-y-3" aria-busy="true" aria-label="Searching">
          {[0, 1, 2].map((i) => (
            <li key={i} className="panel flex gap-4 p-4">
              <div className="size-16 animate-pulse rounded-md bg-paper" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded bg-paper" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-paper" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-paper" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <>
          <section className="space-y-3">
            <h2 className="text-2xl">
              {result.options.length === 0 ? `No shops found in ${where}` : `${result.options.length} options in ${where}`}
            </h2>
            {result.options.length === 0 ? (
              <p className="panel p-6 text-ink-soft">
                Try a shorter name (for example "AirPods Pro" instead of the full model), or search another country.
              </p>
            ) : (
              <ul className="space-y-3">
                {result.options.map((o) => (
                  <OptionCard key={o.item_url} o={o} country={result.country} query={result.query} />
                ))}
              </ul>
            )}
          </section>

          {result.stores.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-2xl">
                <StoreIcon className="size-5" aria-hidden />
                More stores in {where}
              </h2>
              <ul className="panel divide-y divide-line">
                {result.stores.map((s) => (
                  <StoreRow key={`${s.shop}|${s.address}`} s={s} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
