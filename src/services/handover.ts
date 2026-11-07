import { supabase } from '../lib/supabase'
import { AppError } from '../lib/errors'
import type { AppSettings, Currency, Hub, Order, OrderProof } from '../lib/database.types'

// ---------- Service fee ----------

export async function fetchSettings(): Promise<AppSettings | null> {
  const { data, error } = await supabase.from('app_settings').select('*').maybeSingle()
  if (error) throw error
  return data
}

/** What the shopper pays on top of item + reward. */
export function shopperFee(settings: AppSettings | null, currency: Currency): number {
  if (!settings || settings.fee_payer !== 'shopper') return 0
  return currency === 'LBP' ? settings.service_fee_lbp : settings.service_fee_usd
}

// ---------- Hubs ----------

export async function listHubs(): Promise<Hub[]> {
  const { data, error } = await supabase.from('hubs').select('*').eq('is_active', true).order('name')
  if (error) throw error
  return data
}

export async function getHub(id: string): Promise<Hub | null> {
  const { data, error } = await supabase.from('hubs').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

/** Hubs this user staffs (admins see none here unless added as staff). */
export async function myHubs(userId: string): Promise<Hub[]> {
  const { data, error } = await supabase.from('hub_operators').select('hub_id').eq('user_id', userId)
  if (error) throw error
  if (data.length === 0) return []
  const { data: hubs, error: hErr } = await supabase.from('hubs').select('*').in('id', data.map((r) => r.hub_id))
  if (hErr) throw hErr
  return hubs
}

export async function hubOrders(hubIds: string[]): Promise<Order[]> {
  if (hubIds.length === 0) return []
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .in('hub_id', hubIds)
    .in('status', ['PURCHASING', 'IN_TRANSIT', 'DELIVERED'])
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data
}

// ---------- Proof of purchase (3.1) ----------

const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function validateProofFile(file: File): string | null {
  if (!PROOF_TYPES.includes(file.type)) return 'Use JPG, PNG or WebP photos'
  if (file.size > 10 * 1024 * 1024) return 'Each photo must be under 10 MB'
  return null
}

export async function uploadProofPhoto(orderId: string, file: File, kind: 'item' | 'receipt'): Promise<string> {
  const problem = validateProofFile(file)
  if (problem) throw new AppError(problem)
  const ext = file.type.split('/')[1]
  const path = `${orderId}/${Date.now()}-${kind}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  const { error } = await supabase.storage.from('order-proofs').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

export async function submitProof(orderId: string, itemPaths: string[], receiptPaths: string[]): Promise<void> {
  const { error } = await supabase.rpc('submit_proof', {
    p_order_id: orderId,
    p_item_paths: itemPaths,
    p_receipt_paths: receiptPaths,
  })
  if (error) throw error
}

export type ProofWithUrl = OrderProof & { url: string | null }

export async function listProofs(orderId: string): Promise<ProofWithUrl[]> {
  const { data, error } = await supabase.from('order_proofs').select('*').eq('order_id', orderId).order('created_at')
  if (error) throw error
  if (data.length === 0) return []
  const { data: signed } = await supabase.storage.from('order-proofs').createSignedUrls(
    data.map((p) => p.path),
    600,
  )
  return data.map((p, i) => ({ ...p, url: signed?.[i]?.signedUrl ?? null }))
}

export async function reviewProof(orderId: string, approve: boolean, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('review_proof', { p_order_id: orderId, p_approve: approve, p_reason: reason ?? null })
  if (error) throw error
}

// ---------- OTP handover (3.2) ----------

export async function getHandoverCode(orderId: string): Promise<{ code: string; attempts: number } | null> {
  const { data, error } = await supabase.from('handover_otps').select('code, attempts').eq('order_id', orderId).maybeSingle()
  if (error) throw error
  return data
}

export async function regenerateHandoverCode(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('regenerate_handover_code', { p_order_id: orderId })
  if (error) throw error
}

export async function confirmHandover(orderId: string, code: string): Promise<'released' | 'wrong_code' | 'locked'> {
  const { data, error } = await supabase.rpc('confirm_handover', { p_order_id: orderId, p_code: code })
  if (error) throw error
  return data as 'released' | 'wrong_code' | 'locked'
}

// ---------- Hub QR (3.3) ----------

export async function getHubToken(orderId: string): Promise<string | null> {
  const { data, error } = await supabase.from('hub_tokens').select('token').eq('order_id', orderId).maybeSingle()
  if (error) throw error
  return data?.token ?? null
}

export function hubScanUrl(token: string): string {
  return `${window.location.origin}/hub/scan/${token}`
}

export async function hubLookup(token: string) {
  const { data, error } = await supabase.rpc('hub_lookup', { p_token: token })
  if (error) throw error
  return data[0] ?? null
}

export async function hubConfirmDropoff(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('hub_confirm_dropoff', { p_token: token })
  if (error) throw error
  return data
}
