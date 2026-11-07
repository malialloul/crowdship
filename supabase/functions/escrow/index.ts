// Supabase Edge Function: escrow  (Whish escrow hold & release)
//
//   POST { action: "create_hold", order_id }            shopper of an order with an accepted offer
//   POST { action: "verify", escrow_id, mock_outcome? } shopper or admin
//   POST { action: "release", escrow_id, reason? }      admin
//   GET|POST ?escrow_id=…&token=…                       Whish callback
//
// Amounts always come from the order and its accepted offer, never from the browser.
//
// Deploy with JWT verification OFF (Whish calls the callback without a Supabase
// token). Every user action checks the caller's session itself below.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

// ---------------------------------------------------------------- http helpers
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  Vary: 'Origin',
}

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status)
  const pg = err as { code?: string; message?: string }
  if (pg?.code === 'P0001') return json({ error: pg.message, code: 'invalid_transition' }, 409)
  if (pg?.code === 'P0002') return json({ error: pg.message, code: 'not_found' }, 404)
  if (pg?.code === '42501') return json({ error: pg.message, code: 'forbidden' }, 403)
  console.error(err)
  return json({ error: 'Internal error' }, 500)
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function assertUuid(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, `${field} must be a UUID`)
  return v
}

const appUrl = () => requireEnv('APP_URL').replace(/\/$/, '')
const functionsBaseUrl = () =>
  (Deno.env.get('PUBLIC_FUNCTIONS_URL') ?? `${requireEnv('SUPABASE_URL')}/functions/v1`).replace(/\/$/, '')

// ---------------------------------------------------------------- supabase
let _admin: SupabaseClient | null = null
function db(): SupabaseClient {
  _admin ??= createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}

interface Caller {
  id: string
  role: 'user' | 'admin'
  kyc_status: 'not_submitted' | 'pending' | 'verified' | 'rejected'
}

async function requireCaller(req: Request): Promise<Caller> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Missing Authorization header')
  const { data, error } = await db().auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Invalid or expired session')
  const { data: profile, error: pErr } = await db()
    .from('profiles')
    .select('id, role, kyc_status')
    .eq('id', data.user.id)
    .single()
  if (pErr || !profile) throw new HttpError(403, 'Profile not found')
  return profile as Caller
}

// ---------------------------------------------------------------- Whish Pay
// POST {base}/payment/whish → { collectUrl }; POST {base}/payment/collect/status → { collectStatus, payerPhoneNumber }
// Headers: channel, secret, websiteUrl. Responses: { status, code, dialog, data }.
// WHISH_MODE=mock skips Whish and shows a local test checkout (never in production).
type Currency = 'USD' | 'LBP'
type CollectStatus = 'success' | 'failed' | 'pending'

class WhishError extends Error {
  constructor(message: string, public body?: unknown) {
    super(message)
  }
}

function whishMode(): 'live' | 'mock' {
  const mode = Deno.env.get('WHISH_MODE')
  if (mode !== 'live' && mode !== 'mock') throw new Error('Set WHISH_MODE to "live" or "mock"')
  if (mode === 'mock') console.warn('[whish] MOCK MODE: no real money moves. Never enable in production.')
  return mode
}

async function whishRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${requireEnv('WHISH_BASE_URL').replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      channel: requireEnv('WHISH_CHANNEL'),
      secret: requireEnv('WHISH_SECRET'),
      websiteUrl: requireEnv('WHISH_WEBSITE_URL'),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let parsed: { status?: boolean; dialog?: { message?: string } | null; data?: T; extra?: T }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new WhishError(`Whish returned non-JSON (HTTP ${res.status})`, text)
  }
  if (!res.ok || !parsed.status) throw new WhishError(parsed.dialog?.message ?? `Whish request failed (HTTP ${res.status})`, parsed)
  const payload = parsed.data ?? parsed.extra
  if (!payload) throw new WhishError('Whish response missing payload', parsed)
  return payload
}

async function whishCreatePayment(input: {
  escrowId: string
  amount: number
  currency: Currency
  invoice: string
  externalId: number
  callbackUrl: string
  returnUrl: string
}): Promise<string> {
  if (whishMode() === 'mock') return `${appUrl()}/payments/${input.escrowId}/mock-whish`
  const data = await whishRequest<{ collectUrl?: string }>('/payment/whish', {
    amount: input.amount,
    currency: input.currency,
    invoice: input.invoice,
    externalId: input.externalId,
    successCallbackUrl: `${input.callbackUrl}&result=success`,
    failureCallbackUrl: `${input.callbackUrl}&result=failure`,
    successRedirectUrl: `${input.returnUrl}?result=success`,
    failureRedirectUrl: `${input.returnUrl}?result=failure`,
  })
  if (!data.collectUrl) throw new WhishError('Whish response missing collectUrl', data)
  return data.collectUrl
}

async function whishCollectStatus(
  currency: Currency,
  externalId: number,
  mockOutcome?: CollectStatus,
): Promise<{ status: CollectStatus; payerPhone: string | null; mode: 'live' | 'mock' }> {
  if (whishMode() === 'mock') {
    return { status: mockOutcome ?? 'pending', payerPhone: mockOutcome === 'success' ? '96170000000' : null, mode: 'mock' }
  }
  const data = await whishRequest<{ collectStatus?: string; payerPhoneNumber?: string | null }>('/payment/collect/status', {
    currency,
    externalId,
  })
  const raw = (data.collectStatus ?? '').toLowerCase()
  const status: CollectStatus = raw === 'success' ? 'success' : raw === 'failed' ? 'failed' : 'pending'
  return { status, payerPhone: data.payerPhoneNumber ?? null, mode: 'live' }
}

// ---------------------------------------------------------------- escrow core
type EscrowStatus = 'PENDING_PAYMENT' | 'HELD' | 'RELEASED' | 'REFUNDED' | 'FAILED' | 'CANCELLED'

interface EscrowRow {
  id: string
  shopper_id: string
  traveler_id: string
  total_amount: number
  currency: Currency
  status: EscrowStatus
  whish_external_id: number
}

async function loadEscrow(id: string): Promise<EscrowRow> {
  const { data, error } = await db().from('escrow_transactions').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, 'Escrow not found')
  return data as EscrowRow
}

// All status changes go through the database state machine (escrow_transition).
async function transition(
  escrowId: string,
  to: EscrowStatus,
  actor: { type: 'user' | 'admin' | 'system' | 'whish'; id?: string },
  reason: string,
  payload: Record<string, unknown> = {},
): Promise<EscrowRow> {
  const { data, error } = await db().rpc('escrow_transition', {
    p_escrow_id: escrowId,
    p_to: to,
    p_actor_type: actor.type,
    p_actor_id: actor.id ?? null,
    p_reason: reason,
    p_payload: payload,
  })
  if (error) throw error
  return data as EscrowRow
}

// Asks Whish whether the shopper paid. Never trusts the redirect or callback alone.
async function syncWithWhish(escrow: EscrowRow, mockOutcome?: CollectStatus): Promise<EscrowStatus> {
  if (escrow.status !== 'PENDING_PAYMENT') return escrow.status
  const r = await whishCollectStatus(escrow.currency, escrow.whish_external_id, mockOutcome)
  if (r.status === 'success') {
    return (await transition(escrow.id, 'HELD', { type: 'whish' }, 'Whish payment confirmed', { payer_phone: r.payerPhone, whish_mode: r.mode })).status
  }
  if (r.status === 'failed') {
    return (await transition(escrow.id, 'FAILED', { type: 'whish' }, 'Whish reported payment failure', { whish_mode: r.mode })).status
  }
  return escrow.status
}

async function callbackToken(escrowId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requireEnv('WHISH_CALLBACK_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(escrowId))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---------------------------------------------------------------- actions
const MAX_TOTAL: Record<Currency, number> = { USD: 10_000, LBP: 900_000_000 }

type Body = Record<string, unknown>

interface OrderRow {
  id: string
  shopper_id: string
  traveler_id: string | null
  title: string
  item_total: number
  agreed_reward: number | null
  currency: Currency
  status: string
}

async function createHold(req: Request, body: Body): Promise<Response> {
  const caller = await requireCaller(req)
  const orderId = assertUuid(body.order_id, 'order_id')
  if (caller.kyc_status !== 'verified') throw new HttpError(403, 'Verify your identity before paying', 'kyc_required')

  whishMode() // fail on misconfiguration before writing anything

  const { data: orderData, error: oErr } = await db()
    .from('orders')
    .select('id, shopper_id, traveler_id, title, item_total, agreed_reward, currency, status')
    .eq('id', orderId)
    .maybeSingle()
  if (oErr) throw oErr
  const order = orderData as OrderRow | null
  if (!order || order.shopper_id !== caller.id) throw new HttpError(404, 'Order not found')
  if (order.status !== 'AWAITING_PAYMENT_HOLD' || !order.traveler_id || order.agreed_reward == null) {
    throw new HttpError(409, 'This order has no accepted offer waiting for payment', 'not_awaiting_payment')
  }
  if (Number(order.item_total) + Number(order.agreed_reward) > MAX_TOTAL[order.currency]) {
    throw new HttpError(400, `Total exceeds the ${MAX_TOTAL[order.currency].toLocaleString()} ${order.currency} limit`)
  }

  const { data: traveler, error: tErr } = await db()
    .from('profiles')
    .select('id, kyc_status')
    .eq('id', order.traveler_id)
    .maybeSingle()
  if (tErr) throw tErr
  if (!traveler || traveler.kyc_status !== 'verified') {
    throw new HttpError(409, 'Traveler identity is not verified', 'traveler_kyc_required')
  }

  // Resume an unfinished payment instead of opening a second one.
  const { data: live, error: lErr } = await db()
    .from('escrow_transactions')
    .select('*')
    .eq('order_id', order.id)
    .in('status', ['PENDING_PAYMENT', 'HELD'])
    .maybeSingle()
  if (lErr) throw lErr
  if (live) {
    const existing = live as EscrowRow & { whish_collect_url: string | null }
    const status = await syncWithWhish(existing)
    if (status === 'HELD') throw new HttpError(409, 'This order is already paid', 'already_paid')
    if (status === 'PENDING_PAYMENT' && existing.whish_collect_url) {
      return json({
        escrow_id: existing.id,
        status,
        total_amount: existing.total_amount,
        currency: existing.currency,
        collect_url: existing.whish_collect_url,
        mode: whishMode(),
      })
    }
  }

  const { data: created, error: cErr } = await db()
    .from('escrow_transactions')
    .insert({
      order_id: order.id,
      shopper_id: caller.id,
      traveler_id: order.traveler_id,
      item_amount: order.item_total,
      reward_amount: order.agreed_reward,
      currency: order.currency,
    })
    .select('*')
    .single()
  if (cErr) {
    if (cErr.code === '23505') throw new HttpError(409, 'A payment for this order is already in progress')
    throw cErr
  }
  const escrow = created as EscrowRow

  await db().from('escrow_events').insert({
    escrow_id: escrow.id,
    to_status: 'PENDING_PAYMENT',
    actor_type: 'user',
    actor_id: caller.id,
    reason: 'Payment hold requested',
    payload: { order_id: order.id },
  })

  try {
    const collectUrl = await whishCreatePayment({
      escrowId: escrow.id,
      amount: escrow.total_amount,
      currency: escrow.currency,
      invoice: `${order.title.slice(0, 60)} (hold #${escrow.whish_external_id})`,
      externalId: escrow.whish_external_id,
      callbackUrl: `${functionsBaseUrl()}/escrow?escrow_id=${escrow.id}&token=${await callbackToken(escrow.id)}`,
      returnUrl: `${appUrl()}/payments/${escrow.id}/return`,
    })
    await db().from('escrow_transactions').update({ whish_collect_url: collectUrl }).eq('id', escrow.id)
    return json({
      escrow_id: escrow.id,
      status: escrow.status,
      total_amount: escrow.total_amount,
      currency: escrow.currency,
      collect_url: collectUrl,
      mode: whishMode(),
    })
  } catch (err) {
    const reason = err instanceof WhishError ? err.message : 'Whish request failed'
    console.error('[escrow] Whish createPayment failed', err)
    await transition(escrow.id, 'FAILED', { type: 'system' }, reason, {
      whish_error: err instanceof WhishError ? (err.body ?? null) : String(err),
    })
    throw new HttpError(502, `Could not start Whish payment: ${reason}`, 'whish_unavailable')
  }
}

async function verify(req: Request, body: Body): Promise<Response> {
  const caller = await requireCaller(req)
  const escrow = await loadEscrow(assertUuid(body.escrow_id, 'escrow_id'))
  if (escrow.shopper_id !== caller.id && caller.role !== 'admin') throw new HttpError(403, 'Not your payment')
  const mock = body.mock_outcome === 'success' || body.mock_outcome === 'failed' ? (body.mock_outcome as CollectStatus) : undefined
  return json({ escrow_id: escrow.id, status: await syncWithWhish(escrow, mock) })
}

async function release(req: Request, body: Body): Promise<Response> {
  const caller = await requireCaller(req)
  if (caller.role !== 'admin') throw new HttpError(403, 'Admins only')
  const escrow = await loadEscrow(assertUuid(body.escrow_id, 'escrow_id'))
  if (escrow.status !== 'HELD' && escrow.status !== 'RELEASED') {
    throw new HttpError(409, `Only HELD funds can be released (current: ${escrow.status})`, 'invalid_transition')
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Handover verified by admin'
  // The database also queues the traveler payout in the same transaction.
  const row = await transition(escrow.id, 'RELEASED', { type: 'admin', id: caller.id }, reason, { method: 'admin' })
  return json({ escrow_id: escrow.id, status: row.status })
}

async function whishCallback(url: URL): Promise<Response> {
  const escrowId = assertUuid(url.searchParams.get('escrow_id'), 'escrow_id')
  if (!timingSafeEqual(url.searchParams.get('token') ?? '', await callbackToken(escrowId))) {
    throw new HttpError(401, 'Invalid callback token')
  }
  const status = await syncWithWhish(await loadEscrow(escrowId))
  console.log(`[escrow] whish callback escrow=${escrowId} hint=${url.searchParams.get('result')} status=${status}`)
  return json({ ok: true, status })
}

// ---------------------------------------------------------------- router
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = new URL(req.url)
    if (url.searchParams.has('token')) return await whishCallback(url)
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST')

    let body: Body
    try {
      body = (await req.json()) as Body
    } catch {
      throw new HttpError(400, 'Request body must be JSON')
    }

    switch (body.action) {
      case 'create_hold':
        return await createHold(req, body)
      case 'verify':
        return await verify(req, body)
      case 'release':
        return await release(req, body)
      default:
        throw new HttpError(400, 'action must be create_hold, verify or release')
    }
  } catch (err) {
    return errorResponse(err)
  }
})
