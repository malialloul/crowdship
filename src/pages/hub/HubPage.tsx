import { useCallback, useEffect, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { useLiveRefresh } from '../../notifications/notifications-context'
import { hubOrders, myHubs } from '../../services/handover'
import { OrderRow } from '../../components/OrderRow'
import { HubAddress } from '../orders/HandoverPanels'
import { messageOf } from '../../lib/errors'
import type { Hub, Order } from '../../lib/database.types'

// Hub staff: what's on its way, and what has been dropped off.
export default function HubPage() {
  const { user } = useAuth()
  const [hubs, setHubs] = useState<Hub[] | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const hs = await myHubs(user.id)
      setHubs(hs)
      setOrders(await hubOrders(hs.map((h) => h.id)))
    } catch (err) {
      setError(messageOf(err))
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])
  useLiveRefresh(() => void load())

  const incoming = orders.filter((o) => o.status !== 'DELIVERED')
  const dropped = orders.filter((o) => o.status === 'DELIVERED')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-4xl">Hub</h1>
        <p className="mt-1 text-ink-soft">Parcels travelers will drop off at your hub.</p>
      </div>

      <section className="flex items-start gap-3 rounded-xl bg-ink p-5 text-white">
        <ScanLine className="mt-1 size-6 shrink-0 text-signal" aria-hidden />
        <p>
          When a traveler arrives, scan the QR code on their phone with your camera. It opens this app so you can confirm the drop-off,
          which pays the traveler.
        </p>
      </section>

      {error && <p className="alert-error">{error}</p>}
      {hubs?.length === 0 && (
        <p className="panel p-6 text-ink-soft">You're not staff at any hub yet. An admin adds you in Table Editor → hub_operators.</p>
      )}
      {hubs && hubs.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {hubs.map((h) => (
            <HubAddress key={h.id} hub={h} />
          ))}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-2xl">On the way ({incoming.length})</h2>
        {incoming.length === 0 ? (
          <p className="panel p-6 text-ink-soft">Nothing expected right now.</p>
        ) : (
          <ul className="panel divide-y divide-line">
            {incoming.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
        )}
      </section>

      {dropped.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">Dropped off, waiting for pickup</h2>
          <ul className="panel divide-y divide-line">
            {dropped.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
