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
