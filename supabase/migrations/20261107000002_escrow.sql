-- =============================================================================
-- Sprint 1 · Story 1.2 — Whish escrow (hold & release) state machine
-- =============================================================================
--
--   PENDING_PAYMENT ──► HELD ──► RELEASED      (handover verified → payout queued)
--          │              └────► REFUNDED      (dispute / cancelled trip — Sprint 4)
--          ├──► FAILED                          (Whish reported failure)
--          └──► CANCELLED                       (shopper abandoned / expired)
--
-- All writes go through Edge Functions using the service role, which call
-- public.escrow_transition(). A trigger rejects illegal transitions even for
-- direct UPDATEs, so the rules hold no matter who writes.

create type public.escrow_status as enum
  ('PENDING_PAYMENT', 'HELD', 'RELEASED', 'REFUNDED', 'FAILED', 'CANCELLED');

create type public.escrow_currency as enum ('USD', 'LBP');

create type public.payout_status as enum ('queued', 'paid', 'failed');

-- ---------- Tables -----------------------------------------------------------
create table public.escrow_transactions (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid,              -- FK to public.orders is added in Sprint 2
  shopper_id        uuid not null references public.profiles (id) on delete restrict,
  traveler_id       uuid not null references public.profiles (id) on delete restrict,
  item_amount       numeric(14, 2) not null check (item_amount > 0),
  reward_amount     numeric(14, 2) not null check (reward_amount >= 0),
  total_amount      numeric(14, 2) generated always as (item_amount + reward_amount) stored,
  currency          public.escrow_currency not null default 'USD',
  status            public.escrow_status not null default 'PENDING_PAYMENT',
  -- Whish requires a numeric, merchant-unique externalId per payment.
  whish_external_id bigint generated always as identity (start with 100001) unique,
  whish_collect_url text,
  payer_phone       text,
  release_method    text check (release_method in ('admin', 'otp', 'hub_qr')),
  held_at           timestamptz,
  released_at       timestamptz,
  refunded_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint escrow_parties_differ check (shopper_id <> traveler_id),
  constraint escrow_lbp_whole check (currency <> 'LBP' or (item_amount = trunc(item_amount) and reward_amount = trunc(reward_amount)))
);

create index escrow_shopper_idx  on public.escrow_transactions (shopper_id, created_at desc);
create index escrow_traveler_idx on public.escrow_transactions (traveler_id, created_at desc);
create index escrow_status_idx   on public.escrow_transactions (status, created_at);
create index escrow_order_idx    on public.escrow_transactions (order_id);
-- One live hold per order (once orders exist).
create unique index escrow_one_live_per_order
  on public.escrow_transactions (order_id)
  where order_id is not null and status in ('PENDING_PAYMENT', 'HELD');

create trigger escrow_set_updated_at
  before update on public.escrow_transactions
  for each row execute function public.set_updated_at();

-- Append-only audit trail.
create table public.escrow_events (
  id          bigint generated always as identity primary key,
  escrow_id   uuid not null references public.escrow_transactions (id) on delete cascade,
  from_status public.escrow_status,
  to_status   public.escrow_status not null,
  actor_type  text not null check (actor_type in ('user', 'admin', 'system', 'whish')),
  actor_id    uuid references public.profiles (id) on delete set null,
  reason      text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index escrow_events_escrow_idx on public.escrow_events (escrow_id, created_at);

-- Money owed to the traveler after RELEASE. Whish Pay's merchant API collects
-- payments; disbursement to the traveler's Whish wallet is executed from the
-- Whish business account and then marked paid here.
create table public.payouts (
  id                 uuid primary key default gen_random_uuid(),
  escrow_id          uuid not null unique references public.escrow_transactions (id) on delete restrict,
  traveler_id        uuid not null references public.profiles (id) on delete restrict,
  amount             numeric(14, 2) not null check (amount > 0),
  currency           public.escrow_currency not null,
  whish_phone        text,
  status             public.payout_status not null default 'queued',
  provider_reference text,
  paid_by            uuid references public.profiles (id) on delete set null,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index payouts_status_idx on public.payouts (status, created_at);

create trigger payouts_set_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

-- ---------- State machine ----------------------------------------------------
create or replace function public.escrow_can_transition(
  p_from public.escrow_status,
  p_to   public.escrow_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'PENDING_PAYMENT' then p_to in ('HELD', 'FAILED', 'CANCELLED')
    when 'HELD'            then p_to in ('RELEASED', 'REFUNDED')
    else false   -- RELEASED, REFUNDED, FAILED, CANCELLED are terminal
  end;
$$;

create or replace function public.escrow_guard_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not public.escrow_can_transition(old.status, new.status) then
    raise exception 'invalid escrow transition % -> %', old.status, new.status
      using errcode = 'P0001';
  end if;

  -- Amounts and parties are frozen once the row exists.
  if new.item_amount <> old.item_amount
     or new.reward_amount <> old.reward_amount
     or new.currency <> old.currency
     or new.shopper_id <> old.shopper_id
     or new.traveler_id <> old.traveler_id then
    raise exception 'escrow amounts and parties are immutable' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger escrow_guard_transition
  before update on public.escrow_transactions
  for each row execute function public.escrow_guard_transition();

-- The single entry point for status changes. Idempotent: asking for the
-- current status is a no-op, so duplicate Whish callbacks are harmless.
create or replace function public.escrow_transition(
  p_escrow_id  uuid,
  p_to         public.escrow_status,
  p_actor_type text,
  p_actor_id   uuid  default null,
  p_reason     text  default null,
  p_payload    jsonb default '{}'::jsonb
)
returns public.escrow_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  public.escrow_transactions;
  v_from public.escrow_status;
begin
  select * into v_row
  from public.escrow_transactions
  where id = p_escrow_id
  for update;

  if not found then
    raise exception 'escrow % not found', p_escrow_id using errcode = 'P0002';
  end if;

  v_from := v_row.status;
  if v_from = p_to then
    return v_row;
  end if;

  if not public.escrow_can_transition(v_from, p_to) then
    raise exception 'invalid escrow transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  update public.escrow_transactions
  set status         = p_to,
      held_at        = case when p_to = 'HELD'     then now() else held_at end,
      released_at    = case when p_to = 'RELEASED' then now() else released_at end,
      refunded_at    = case when p_to = 'REFUNDED' then now() else refunded_at end,
      release_method = case when p_to = 'RELEASED'
                            then coalesce(p_payload ->> 'method', 'admin')
                            else release_method end,
      payer_phone    = coalesce(p_payload ->> 'payer_phone', payer_phone)
  where id = p_escrow_id
  returning * into v_row;

  insert into public.escrow_events (escrow_id, from_status, to_status, actor_type, actor_id, reason, payload)
  values (p_escrow_id, v_from, p_to, p_actor_type, p_actor_id, p_reason, coalesce(p_payload, '{}'::jsonb));

  -- Releasing funds queues the traveler payout in the same transaction.
  if p_to = 'RELEASED' then
    insert into public.payouts (escrow_id, traveler_id, amount, currency, whish_phone)
    select v_row.id, v_row.traveler_id, v_row.total_amount, v_row.currency,
           coalesce(p.whish_phone, p.phone)
    from public.profiles p
    where p.id = v_row.traveler_id;
  end if;

  return v_row;
end;
$$;

-- Admin marks a queued payout as sent from the Whish business account.
create or replace function public.mark_payout_paid(
  p_payout_id uuid,
  p_reference text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reference), '') = '' then
    raise exception 'a Whish transfer reference is required' using errcode = '22023';
  end if;

  update public.payouts
  set status = 'paid', provider_reference = btrim(p_reference), paid_by = auth.uid(), paid_at = now()
  where id = p_payout_id and status = 'queued';

  if not found then
    raise exception 'payout not found or not queued' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------- Privileges & RLS -------------------------------------------------
alter table public.escrow_transactions enable row level security;
alter table public.escrow_events       enable row level security;
alter table public.payouts             enable row level security;

revoke insert, update, delete on public.escrow_transactions from anon, authenticated;
revoke insert, update, delete on public.escrow_events       from anon, authenticated;
revoke insert, update, delete on public.payouts             from anon, authenticated;

create policy "escrow: parties or admin read"
  on public.escrow_transactions for select to authenticated
  using (
    shopper_id = (select auth.uid())
    or traveler_id = (select auth.uid())
    or public.is_admin()
  );

create policy "escrow events: parties or admin read"
  on public.escrow_events for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.escrow_transactions e
      where e.id = escrow_id
        and (e.shopper_id = (select auth.uid()) or e.traveler_id = (select auth.uid()))
    )
  );

create policy "payouts: traveler or admin read"
  on public.payouts for select to authenticated
  using (traveler_id = (select auth.uid()) or public.is_admin());

-- Only the service role (Edge Functions) may move money states.
revoke execute on function public.escrow_transition(uuid, public.escrow_status, text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.escrow_transition(uuid, public.escrow_status, text, uuid, text, jsonb)
  to service_role;

revoke execute on function public.mark_payout_paid(uuid, text) from public, anon;
grant execute on function public.mark_payout_paid(uuid, text) to authenticated;
