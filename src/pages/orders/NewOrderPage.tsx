import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Link2 } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { createOrder, previewProduct } from '../../services/orders'
import { VerifyNotice } from '../../components/VerifyNotice'
import { ORIGINS, todayIso } from '../../lib/places'
import { messageOf } from '../../lib/errors'
import type { Currency } from '../../lib/database.types'

function num(v: string): number {
  return Number(v.replace(',', '.'))
}

export default function NewOrderPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const verified = profile?.kyc_status === 'verified'

  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchNote, setFetchNote] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [currency, setCurrency] = useState<Currency>('USD')
  const [weight, setWeight] = useState('')
  const [country, setCountry] = useState('')
  const [reward, setReward] = useState('')
  const [neededBy, setNeededBy] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchDetails() {
    if (!url.trim()) return
    setFetching(true)
    setFetchNote(null)
    try {
      const p = await previewProduct(url.trim())
      if (p.title) setTitle(p.title)
      if (p.image_url) setImageUrl(p.image_url)
      if (p.country && ORIGINS.some((o) => o.code === p.country)) setCountry(p.country)
      if (p.price && p.currency === 'USD') setPrice(String(p.price))
      const notes: string[] = []
      if (p.note) notes.push(p.note)
      else notes.push(`Filled in what ${p.site ?? 'the shop'} shares. Check every field.`)
      if (p.price && p.currency && p.currency !== 'USD') {
        notes.push(`The shop lists it at ${p.price} ${p.currency}. Enter the price in USD.`)
      }
      setFetchNote(notes.join(' '))
    } catch (err) {
      setFetchNote(messageOf(err))
    } finally {
      setFetching(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const p = num(price)
    const q = Math.round(num(quantity))
    const w = num(weight)
    const r = num(reward)
    if (title.trim().length < 3) return setError('Give the item a name')
    if (!(p > 0)) return setError('Enter the item price')
    if (!(q >= 1 && q <= 20)) return setError('Quantity must be between 1 and 20')
    if (!(w > 0 && w <= 32)) return setError('Estimated weight must be between 0.1 and 32 kg')
    if (!country) return setError('Choose the country the item ships from')
    if (!(r >= 0)) return setError('Enter the reward you offer the traveler (0 or more)')
    if (url.trim() && !/^https?:\/\//i.test(url.trim())) return setError('The shop link must start with https://')

    setBusy(true)
    try {
      const order = await createOrder({
        item_url: url.trim() || null,
        title: title.trim(),
        description: description.trim() || null,
        image_url: imageUrl,
        item_price: p,
        quantity: q,
        currency,
        weight_kg: w,
        origin_country: country,
        reward_amount: r,
        needed_by: neededBy || null,
      })
      navigate(`/orders/${order.id}`, { replace: true })
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-4xl">Post an order</h1>
        <p className="mt-1 text-ink-soft">Tell travelers what you want. They'll offer to bring it, and you pick one.</p>
      </div>

      <VerifyNotice action="post orders" />

      <section className="panel space-y-3 p-6">
        <label htmlFor="url" className="field-label">
          Shop link <span className="font-normal text-mist">(optional)</span>
        </label>
        <div className="flex gap-2">
          <input
            id="url"
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://www.amazon.ae/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="button" className="btn btn-ink shrink-0" disabled={!url.trim() || fetching} onClick={() => void fetchDetails()}>
            <Link2 className="size-4" aria-hidden />
            {fetching ? 'Reading…' : 'Fill in'}
          </button>
        </div>
        {fetchNote && <p className="field-hint">{fetchNote}</p>}
      </section>

      <form onSubmit={onSubmit} className="panel space-y-5 p-6" noValidate>
        <h2 className="text-2xl">Item details</h2>

        {imageUrl && (
          <div className="flex items-center gap-3">
            <img src={imageUrl} alt="" className="size-20 rounded-md border border-line object-contain" />
            <button type="button" className="text-sm font-semibold text-ink-soft underline underline-offset-4" onClick={() => setImageUrl(null)}>
              Remove picture
            </button>
          </div>
        )}

        <div>
          <label htmlFor="title" className="field-label">
            Item name
          </label>
          <input id="title" className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="AirPods Pro (2nd generation)" />
        </div>

        <div className="grid grid-cols-[1fr_5rem_6rem] gap-3">
          <div>
            <label htmlFor="price" className="field-label">
              Price each
            </label>
            <input id="price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="249" />
          </div>
          <div>
            <label htmlFor="qty" className="field-label">
              Qty
            </label>
            <input id="qty" className="input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cur" className="field-label">
              Currency
            </label>
            <select id="cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              <option value="USD">USD</option>
              <option value="LBP">LBP</option>
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="country" className="field-label">
              Ships from
            </label>
            <select id="country" className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
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
            <label htmlFor="weight" className="field-label">
              Estimated weight (kg)
            </label>
            <input id="weight" className="input" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.5" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="reward" className="field-label">
              Reward for the traveler ({currency})
            </label>
            <input id="reward" className="input" inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)} placeholder="25" />
            <p className="field-hint">Travelers can accept it or propose another amount.</p>
          </div>
          <div>
            <label htmlFor="needed" className="field-label">
              Needed by <span className="font-normal text-mist">(optional)</span>
            </label>
            <input id="needed" className="input" type="date" min={todayIso()} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </div>
        </div>

        <div>
          <label htmlFor="desc" className="field-label">
            Notes for the traveler <span className="font-normal text-mist">(optional)</span>
          </label>
          <textarea
            id="desc"
            className="input"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Size, colour, which store sells it…"
          />
        </div>

        {error && <p className="alert-error" role="alert">{error}</p>}

        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={busy || !verified}>
          {busy ? 'Posting…' : 'Post order'}
        </button>
      </form>
    </div>
  )
}
