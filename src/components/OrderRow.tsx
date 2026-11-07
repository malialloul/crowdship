import { Link } from 'react-router'
import { Thumb } from './Thumb'
import { OrderTag } from './StatusTags'
import { countryName } from '../lib/places'
import { money } from '../lib/format'
import type { Order } from '../lib/database.types'

export function OrderRow({ order, note }: { order: Order; note?: string }) {
  return (
    <li>
      <Link to={`/orders/${order.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-paper">
        <Thumb src={order.image_url} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-[17px] font-semibold">{order.title}</p>
          <p className="truncate text-sm text-ink-soft [&>span+span]:ml-3">
            <span>{money(order.item_total, order.currency)}</span>
            <span>Reward {money(order.agreed_reward ?? order.reward_amount, order.currency)}</span>
            <span>From {countryName(order.origin_country)}</span>
          </p>
          {note && <p className="truncate text-sm text-mist">{note}</p>}
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
