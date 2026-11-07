import { Link } from 'react-router'
import { Package } from 'lucide-react'
import { OrderTag } from './StatusTags'
import { countryName } from '../lib/places'
import { money } from '../lib/format'
import type { Order } from '../lib/database.types'

export function OrderRow({ order, note }: { order: Order; note?: string }) {
  return (
    <li>
      <Link to={`/orders/${order.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-paper">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-paper">
          {order.image_url ? (
            <img src={order.image_url} alt="" className="size-full object-contain" loading="lazy" />
          ) : (
            <Package className="size-6 text-mist" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-[17px] font-semibold">{order.title}</p>
          <p className="flex flex-wrap gap-x-3 text-sm text-ink-soft">
            <span>{money(order.item_total, order.currency)}</span>
            <span>Reward {money(order.agreed_reward ?? order.reward_amount, order.currency)}</span>
            <span>From {countryName(order.origin_country)}</span>
          </p>
          {note && <p className="text-sm text-mist">{note}</p>}
        </div>
        <div className="hidden shrink-0 sm:block">
          <OrderTag status={order.status} />
        </div>
      </Link>
      <div className="-mt-2 px-5 pb-3 sm:hidden">
        <OrderTag status={order.status} />
      </div>
    </li>
  )
}
