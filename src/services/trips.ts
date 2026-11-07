import { supabase } from '../lib/supabase'
import type { Order, Trip } from '../lib/database.types'

export interface NewTrip {
  origin_country: string
  origin_city: string
  travel_date: string
  capacity_kg: number
  notes: string | null
}

export async function createTrip(input: NewTrip): Promise<Trip> {
  const { data, error } = await supabase.from('trips').insert(input).select('*').single()
  if (error) throw error
  return data
}

export async function listMyTrips(userId: string): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('traveler_id', userId)
    .order('travel_date', { ascending: false })
    .limit(100)
  if (error) throw error
  return data
}

export async function getTrip(id: string): Promise<Trip | null> {
  const { data, error } = await supabase.from('trips').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function setTripStatus(id: string, status: 'OPEN' | 'CLOSED' | 'CANCELLED'): Promise<void> {
  const { error } = await supabase.from('trips').update({ status }).eq('id', id)
  if (error) throw error
}

export async function committedKg(tripId: string): Promise<number> {
  const { data, error } = await supabase.rpc('trip_committed_kg', { p_trip_id: tripId })
  if (error) throw error
  return Number(data)
}

/** Story 2.2 — open orders on this trip's route that fit the space left. */
export async function matchingOrders(tripId: string): Promise<Order[]> {
  const { data, error } = await supabase.rpc('matching_orders', { p_trip_id: tripId })
  if (error) throw error
  return data
}

/** My open trips that could carry an order from this country, landing in time. */
export async function eligibleTrips(userId: string, order: Order, today: string): Promise<Trip[]> {
  let q = supabase
    .from('trips')
    .select('*')
    .eq('traveler_id', userId)
    .eq('status', 'OPEN')
    .eq('origin_country', order.origin_country)
    .gte('travel_date', today)
    .order('travel_date', { ascending: true })
  if (order.needed_by) q = q.lte('travel_date', order.needed_by)
  const { data, error } = await q
  if (error) throw error
  return data
}

export interface TripActivity {
  /** Matching open orders you haven't offered on yet. */
  waiting: number
  /** Your offers still being negotiated. */
  offered: number
  /** Orders you agreed to carry on this trip. */
  carrying: number
  /** Kilos already promised to shoppers. */
  usedKg: number
}

/** Counts for the trips list, so trips with work to do stand out. */
export async function tripActivity(trips: Trip[], today: string): Promise<Map<string, TripActivity>> {
  const ids = trips.map((t) => t.id)
  const result = new Map<string, TripActivity>(ids.map((id) => [id, { waiting: 0, offered: 0, carrying: 0, usedKg: 0 }]))
  if (ids.length === 0) return result

  const openTrips = trips.filter((t) => t.status === 'OPEN' && t.travel_date >= today)
  const [matches, carrying, offers] = await Promise.all([
    Promise.all(openTrips.map((t) => matchingOrders(t.id).catch(() => [] as Order[]))),
    supabase.from('orders').select('trip_id, weight_kg').in('trip_id', ids).neq('status', 'CANCELLED'),
    supabase.from('offers').select('trip_id, order_id').in('trip_id', ids).eq('status', 'PENDING'),
  ])
  if (carrying.error) throw carrying.error
  if (offers.error) throw offers.error

  const offeredOrders = new Set(offers.data.map((o) => o.order_id))
  for (const o of offers.data) result.get(o.trip_id)!.offered += 1
  for (const o of carrying.data) {
    if (!o.trip_id) continue
    const a = result.get(o.trip_id)!
    a.carrying += 1
    a.usedKg += Number(o.weight_kg ?? 0)
  }
  openTrips.forEach((t, i) => {
    result.get(t.id)!.waiting = matches[i].filter((m) => !offeredOrders.has(m.id)).length
  })
  return result
}
