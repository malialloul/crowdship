import { supabase } from '../lib/supabase'
import { invokeFunction } from '../lib/errors'
import type { Currency, Offer, OfferEvent, Order, PublicProfile, Trip } from '../lib/database.types'

export interface NewOrder {
  item_url: string | null
  title: string
  description: string | null
  image_url: string | null
  item_price: number
  quantity: number
  currency: Currency
  weight_kg: number
  origin_country: string
  reward_amount: number
  needed_by: string | null
}

export async function createOrder(input: NewOrder): Promise<Order> {
  const { data, error } = await supabase.from('orders').insert(input).select('*').single()
  if (error) throw error
  return data
}

export async function getOrder(id: string): Promise<Order | null> {
  const { data, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

/** Orders I posted (as shopper). */
export async function listMyOrders(userId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('shopper_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data
}

/** Orders I'm carrying (accepted offers). */
export async function listCarrying(userId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('traveler_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data
}

export async function cancelOrder(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_order', { p_order_id: id })
  if (error) throw error
}

export interface ProductPreview {
  title: string | null
  image_url: string | null
  price: number | null
  currency: string | null
  site: string | null
  country: string | null
  note?: string
}

export function previewProduct(url: string): Promise<ProductPreview> {
  return invokeFunction<ProductPreview>('product-preview', { url })
}

// ---------- Offers ----------

export async function listOffersForOrder(orderId: string): Promise<Offer[]> {
  const { data, error } = await supabase
    .from('offers')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function listOfferEvents(offerIds: string[]): Promise<OfferEvent[]> {
  if (offerIds.length === 0) return []
  const { data, error } = await supabase
    .from('offer_events')
    .select('*')
    .in('offer_id', offerIds)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function listTripsByIds(ids: string[]): Promise<Trip[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('trips').select('*').in('id', ids)
  if (error) throw error
  return data
}

export async function makeOffer(orderId: string, tripId: string, amount: number, message?: string): Promise<string> {
  const { data, error } = await supabase.rpc('make_offer', {
    p_order_id: orderId,
    p_trip_id: tripId,
    p_amount: amount,
    p_message: message?.trim() || null,
  })
  if (error) throw error
  return data
}

export async function respondOffer(
  offerId: string,
  action: 'accept' | 'counter' | 'decline' | 'withdraw',
  amount?: number,
): Promise<Offer> {
  const { data, error } = await supabase.rpc('respond_offer', {
    p_offer_id: offerId,
    p_action: action,
    p_amount: amount ?? null,
  })
  if (error) throw error
  return data
}

export async function fetchPublicProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return new Map()
  const { data, error } = await supabase.rpc('public_profiles', { p_ids: unique })
  if (error) throw error
  return new Map(data.map((p) => [p.id, p]))
}
