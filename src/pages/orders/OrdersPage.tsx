import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { useLiveRefresh } from '../../notifications/notifications-context'
import { listCarrying, listMyOrders } from '../../services/orders'
import { OrderRow } from '../../components/OrderRow'
import { SearchBar } from '../../components/SearchBar'
import { messageOf } from '../../lib/errors'
import type { Order } from '../../lib/database.types'

export default function OrdersPage() {
  const { user } = useAuth()
  const [mine, setMine] = useState<Order[] | null>(null)
  const [carrying, setCarrying] = useState<Order[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const [a, b] = await Promise.all([listMyOrders(user.id), listCarrying(user.id)])
      setMine(a)
      setCarrying(b)
      setError(null)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])
  useLiveRefresh(() => void load())

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl">Orders</h1>
          <p className="mt-1 text-ink-soft">Things you want brought to Lebanon, and things you're carrying.</p>
        </div>
        <Link to="/orders/new" className="btn btn-primary">
          <Plus className="size-4" aria-hidden />
          Post an order
        </Link>
      </div>

      <section className="space-y-3 rounded-xl bg-ink p-5 sm:p-6">
        <h2 className="text-2xl text-white">What do you want from abroad?</h2>
        <SearchBar />
      </section>

      {error && <p className="alert-error">{error}</p>}

      {carrying.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">You're carrying</h2>
          <ul className="panel divide-y divide-line">
            {carrying.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-2xl">Your orders</h2>
        <div className="panel">
          {mine === null ? (
            <p className="p-6 text-mist">Loading…</p>
          ) : mine.length === 0 ? (
            <div className="space-y-3 p-6">
              <p className="text-ink-soft">
                Post what you want from abroad: paste a shop link or type the details, and set a reward for the traveler.
              </p>
              <Link to="/orders/new" className="btn btn-quiet">
                Post your first order
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {mine.map((o) => (
                <OrderRow key={o.id} order={o} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
