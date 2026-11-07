import { supabase } from '../lib/supabase'
import { invokeFunction } from '../lib/errors'
import type { Currency, Escrow, EscrowStatus, Payout, Profile } from '../lib/database.types'

export interface HoldResult {
  escrow_id: string
  status: EscrowStatus
  total_amount: number
  currency: Currency
  collect_url: string
  mode: 'live' | 'mock'
}

/**
 * Starts a Whish payment hold. Sprint 2 calls this when the shopper accepts
 * an offer (passing order_id); the browser is then sent to `collect_url`.
 */
export function startPaymentHold(input: {
  traveler_id: string
  item_amount: number
  reward_amount: number
  currency: Currency
  order_id?: string
}): Promise<HoldResult> {
  return invokeFunction<HoldResult>('escrow', { action: 'create_hold', ...input })
}

export function verifyPayment(escrowId: string, mockOutcome?: 'success' | 'failed') {
  return invokeFunction<{ escrow_id: string; status: EscrowStatus }>('escrow', {
    action: 'verify',
    escrow_id: escrowId,
    ...(mockOutcome ? { mock_outcome: mockOutcome } : {}),
  })
}

export function releaseEscrow(escrowId: string, reason?: string) {
  return invokeFunction<{ escrow_id: string; status: EscrowStatus }>('escrow', {
    action: 'release',
    escrow_id: escrowId,
    ...(reason ? { reason } : {}),
  })
}

export async function getEscrow(escrowId: string): Promise<Escrow | null> {
  const { data, error } = await supabase.from('escrow_transactions').select('*').eq('id', escrowId).maybeSingle()
  if (error) throw error
  return data
}

export async function listMyEscrows(): Promise<Escrow[]> {
  // RLS limits this to holds where the user is shopper or traveler.
  const { data, error } = await supabase
    .from('escrow_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data
}

// ---------- Admin ----------

type Party = Pick<Profile, 'full_name' | 'phone'> | null

export type AdminEscrow = Escrow & {
  shopper: Party
  traveler: (Party & { whish_phone?: string | null }) | null
}

export async function listEscrowsAdmin(status: EscrowStatus | 'ALL'): Promise<AdminEscrow[]> {
  let q = supabase
    .from('escrow_transactions')
    .select(
      '*, shopper:profiles!escrow_transactions_shopper_id_fkey(full_name, phone), traveler:profiles!escrow_transactions_traveler_id_fkey(full_name, phone, whish_phone)',
    )
    .order('created_at', { ascending: false })
    .limit(100)
  if (status !== 'ALL') q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data
}

export type AdminPayout = Payout & { traveler: Party }

export async function listQueuedPayouts(): Promise<AdminPayout[]> {
  const { data, error } = await supabase
    .from('payouts')
    .select('*, traveler:profiles!payouts_traveler_id_fkey(full_name, phone)')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function markPayoutPaid(payoutId: string, reference: string): Promise<void> {
  const { error } = await supabase.rpc('mark_payout_paid', { p_payout_id: payoutId, p_reference: reference })
  if (error) throw error
}
