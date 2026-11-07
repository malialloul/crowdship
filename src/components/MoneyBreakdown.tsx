import { money } from '../lib/format'
import type { Currency } from '../lib/database.types'

export interface Split {
  item: number
  reward: number
  fee: number
  feePayer: string
  currency: Currency
}

/** Who gets what out of one escrow payment. */
export function splitAmounts(s: Split) {
  const travelerPaysFee = s.feePayer === 'traveler'
  return {
    shopperPays: s.item + s.reward + (travelerPaysFee ? 0 : s.fee),
    travelerGets: s.item + s.reward - (travelerPaysFee ? s.fee : 0),
    appKeeps: s.fee,
  }
}

export function splitFromEscrow(e: {
  item_amount: number
  reward_amount: number
  platform_fee: number
  fee_payer: string
  currency: Currency
}): Split {
  return {
    item: Number(e.item_amount),
    reward: Number(e.reward_amount),
    fee: Number(e.platform_fee),
    feePayer: e.fee_payer,
    currency: e.currency,
  }
}

function feeLabel(payer: string, viewer: 'shopper' | 'traveler' | 'admin') {
  const byTraveler = payer === 'traveler'
  if (viewer === 'admin') return byTraveler ? 'App commission (from traveler)' : 'App commission (shopper pays)'
  if (viewer === 'traveler') return byTraveler ? 'App commission' : 'App commission (shopper pays)'
  return byTraveler ? 'App commission (traveler pays)' : 'App commission'
}

/**
 * Item price, traveler commission and app commission, with the totals that
 * matter to whoever is looking. Nobody has to work out an amount by hand.
 */
export function MoneyBreakdown({
  split,
  viewer,
  tone = 'light',
}: {
  split: Split
  viewer: 'shopper' | 'traveler' | 'admin'
  tone?: 'light' | 'dark'
}) {
  const { shopperPays, travelerGets, appKeeps } = splitAmounts(split)
  // Shown as a minus only where it comes out of the traveler's money.
  const deducted = split.feePayer === 'traveler' && viewer !== 'shopper'
  const c = split.currency
  const muted = tone === 'dark' ? 'text-white/70' : 'text-ink-soft'
  const rule = tone === 'dark' ? 'border-white/20' : 'border-line'

  const Row = ({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) => (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : `${muted} truncate`}>{label}</dt>
      <dd className="shrink-0 whitespace-nowrap">{value}</dd>
    </div>
  )

  return (
    <dl className="space-y-1 text-[15px]">
      <Row label="Item price" value={money(split.item, c)} />
      <Row label="Traveler commission" value={money(split.reward, c)} />
      {appKeeps > 0 && <Row label={feeLabel(split.feePayer, viewer)} value={`${deducted ? '−' : ''}${money(appKeeps, c)}`} />}
      <div className={`space-y-1 border-t pt-1 ${rule}`}>
        {viewer !== 'traveler' && <Row label={viewer === 'shopper' ? 'You pay' : 'Shopper paid'} value={money(shopperPays, c)} strong />}
        {viewer !== 'shopper' && <Row label={viewer === 'traveler' ? 'You receive' : 'Send to traveler'} value={money(travelerGets, c)} strong />}
        {viewer === 'admin' && appKeeps > 0 && <Row label="App keeps" value={money(appKeeps, c)} strong />}
      </div>
    </dl>
  )
}
