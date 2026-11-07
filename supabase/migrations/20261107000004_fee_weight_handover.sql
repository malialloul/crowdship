-- =============================================================================
-- Service fee, traveler-set weight, and Sprint 3 (proof of purchase, OTP
-- handover, hub drop-off with QR)
-- =============================================================================

-- ---------- 1. Service fee ($1 per confirmed order, kept by the platform) -----
create table public.app_settings (
  id              boolean primary key default true check (id),
  service_fee_usd numeric(14, 2) not null default 1 check (service_fee_usd >= 0),
  service_fee_lbp numeric(14, 2) not null default 90000 check (service_fee_lbp >= 0),
  -- 'shopper' adds the fee to what the shopper pays; 'traveler' takes it from the payout.
  fee_payer       text not null default 'shopper' check (fee_payer in ('shopper', 'traveler')),
  updated_at      timestamptz not null default now()
);
insert into public.app_settings default values on conflict do nothing;

alter table public.escrow_transactions
  add column platform_fee numeric(14, 2) not null default 0 check (platform_fee >= 0),
  add column fee_payer    text not null default 'shopper' check (fee_payer in ('shopper', 'traveler'));

-- total_amount is what the shopper pays into escrow.
alter table public.escrow_transactions drop column total_amount;
alter table public.escrow_transactions
  add column total_amount numeric(14, 2)
  generated always as (item_amount + reward_amount + case when fee_payer = 'shopper' then platform_fee else 0 end) stored;

-- Every order payment picks up the current fee when it is created.
create or replace function public.escrow_apply_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.app_settings;
begin
  if new.order_id is null then
    return new;
  end if;
  select * into s from public.app_settings where id;
  new.fee_payer := coalesce(s.fee_payer, 'shopper');
  new.platform_fee := case when new.currency = 'LBP' then coalesce(s.service_fee_lbp, 0) else coalesce(s.service_fee_usd, 0) end;
  if new.fee_payer = 'traveler' and new.platform_fee > new.item_amount + new.reward_amount then
    new.platform_fee := 0;
  end if;
  return new;
end;
$$;

create trigger escrow_apply_fee
  before insert on public.escrow_transactions
  for each row execute function public.escrow_apply_fee();

-- Amounts, parties and fee are frozen once the row exists.
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
  if new.item_amount <> old.item_amount
     or new.reward_amount <> old.reward_amount
     or new.platform_fee <> old.platform_fee
     or new.fee_payer <> old.fee_payer
     or new.currency <> old.currency
     or new.shopper_id <> old.shopper_id
     or new.traveler_id <> old.traveler_id then
    raise exception 'escrow amounts and parties are immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Same state machine as before; the payout now excludes the platform's fee.
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
  select * into v_row from public.escrow_transactions where id = p_escrow_id for update;
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
      release_method = case when p_to = 'RELEASED' then coalesce(p_payload ->> 'method', 'admin') else release_method end,
      payer_phone    = coalesce(p_payload ->> 'payer_phone', payer_phone)
  where id = p_escrow_id
  returning * into v_row;

  insert into public.escrow_events (escrow_id, from_status, to_status, actor_type, actor_id, reason, payload)
  values (p_escrow_id, v_from, p_to, p_actor_type, p_actor_id, p_reason, coalesce(p_payload, '{}'::jsonb));

  if p_to = 'RELEASED' then
    insert into public.payouts (escrow_id, traveler_id, amount, currency, whish_phone)
    select v_row.id, v_row.traveler_id,
           v_row.item_amount + v_row.reward_amount - case when v_row.fee_payer = 'traveler' then v_row.platform_fee else 0 end,
           v_row.currency, coalesce(p.whish_phone, p.phone)
    from public.profiles p
    where p.id = v_row.traveler_id;
  end if;

  return v_row;
end;
$$;

-- ---------- 2. Weight is set by the traveler, in their offer -----------------
alter table public.orders alter column weight_kg drop not null;
revoke insert on public.orders from authenticated;
grant insert (item_url, title, description, image_url, item_price, quantity, currency, origin_country, reward_amount, needed_by)
  on public.orders to authenticated;

alter table public.offers
  add column weight_kg numeric(5, 2) check (weight_kg is null or (weight_kg > 0 and weight_kg <= 32));

-- ---------- 3. Hubs and handover method (Story 3.3) --------------------------
create type public.handover_method as enum ('in_person', 'hub');

create table public.hubs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  area          text not null,
  address       text,
  opening_hours text,
  maps_url      text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Example hubs: rename or replace them in Table Editor → hubs.
insert into public.hubs (name, area, address, opening_hours) values
  ('Hamra hub', 'Hamra, Beirut', 'Hamra Street', 'Mon–Sat 10:00–19:00'),
  ('Achrafieh hub', 'Achrafieh, Beirut', 'Sassine Square', 'Mon–Sat 10:00–19:00');

-- Who may scan QR codes at a hub. Add rows in Table Editor → hub_operators.
create table public.hub_operators (
  hub_id     uuid not null references public.hubs (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (hub_id, user_id)
);

alter table public.offers
  add column handover public.handover_method not null default 'in_person',
  add column hub_id   uuid references public.hubs (id) on delete restrict,
  add constraint offers_hub_required check (handover <> 'hub' or hub_id is not null);

alter table public.orders
  add column handover               public.handover_method,
  add column hub_id                 uuid references public.hubs (id) on delete restrict,
  add column proof_status           text not null default 'none' check (proof_status in ('none', 'submitted', 'approved', 'rejected')),
  add column proof_rejection_reason text,
  add column proof_submitted_at     timestamptz,
  add column proof_approved_at      timestamptz,
  add column delivered_via          public.handover_method,
  add column delivered_at           timestamptz,
  add column hub_dropoff_at         timestamptz;

create index orders_hub_idx on public.orders (hub_id, status) where hub_id is not null;

-- ---------- 4. Helpers --------------------------------------------------------
create or replace function public.is_order_traveler(p_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.orders where id::text = p_order_id and traveler_id = (select auth.uid()));
$$;

create or replace function public.is_order_party(p_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders
    where id::text = p_order_id and (shopper_id = (select auth.uid()) or traveler_id = (select auth.uid()))
  );
$$;

create or replace function public.is_hub_operator(p_hub_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or exists (select 1 from public.hub_operators where hub_id = p_hub_id and user_id = (select auth.uid()));
$$;

-- 6 digits from the UUID generator's strong randomness.
create or replace function public.random_code6()
returns text
language sql
volatile
set search_path = ''
as $$
  select lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
$$;

-- ---------- 5. Matching: orders no longer carry a weight --------------------
create or replace function public.matching_orders(p_trip_id uuid)
returns setof public.orders
language sql
stable
set search_path = ''
as $$
  select o.*
  from public.trips t
  join public.orders o
    on o.origin_country = t.origin_country
   and o.status = 'SEARCHING_TRAVELER'
   and o.shopper_id <> t.traveler_id
   and (o.weight_kg is null or o.weight_kg <= t.capacity_kg - public.trip_committed_kg(t.id))
   and (o.needed_by is null or o.needed_by >= t.travel_date)
  where t.id = p_trip_id
    and t.traveler_id = (select auth.uid())
    and t.status = 'OPEN'
    and t.capacity_kg - public.trip_committed_kg(t.id) > 0
  order by o.created_at desc
  limit 100;
$$;

-- ---------- 6. Offers: weight + handover chosen by the traveler -------------
drop function if exists public.make_offer(uuid, uuid, numeric, text);

create or replace function public.make_offer(
  p_order_id  uuid,
  p_trip_id   uuid,
  p_amount    numeric,
  p_weight_kg numeric,
  p_handover  public.handover_method default 'in_person',
  p_hub_id    uuid default null,
  p_message   text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders;
  v_trip  public.trips;
  v_left  numeric;
  v_id    uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.is_verified() then
    raise exception 'verify your identity before making offers' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if v_order.status <> 'SEARCHING_TRAVELER' then
    raise exception 'this order is no longer taking offers' using errcode = 'P0001';
  end if;
  if v_order.shopper_id = v_uid then
    raise exception 'you cannot make an offer on your own order' using errcode = 'P0001';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  if not found or v_trip.traveler_id <> v_uid then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;
  if v_trip.status <> 'OPEN' or v_trip.travel_date < current_date then
    raise exception 'this trip is closed' using errcode = 'P0001';
  end if;
  if v_trip.origin_country <> v_order.origin_country then
    raise exception 'this trip does not leave from the order''s country' using errcode = 'P0001';
  end if;
  if v_order.needed_by is not null and v_order.needed_by < v_trip.travel_date then
    raise exception 'your trip lands after the date the shopper needs it' using errcode = 'P0001';
  end if;

  if p_weight_kg is null or p_weight_kg <= 0 or p_weight_kg > 32 then
    raise exception 'enter the weight in kg (up to 32)' using errcode = '22023';
  end if;
  v_left := v_trip.capacity_kg - public.trip_committed_kg(v_trip.id);
  if p_weight_kg > v_left then
    raise exception 'only % kg left on this trip', v_left using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount < 0 or p_amount > 100000000 then
    raise exception 'enter a valid reward' using errcode = '22023';
  end if;
  if v_order.currency = 'LBP' and p_amount <> trunc(p_amount) then
    raise exception 'LBP rewards must be whole numbers' using errcode = '22023';
  end if;

  if p_handover = 'hub' then
    if p_hub_id is null or not exists (select 1 from public.hubs where id = p_hub_id and is_active) then
      raise exception 'choose a drop-off hub' using errcode = '22023';
    end if;
  end if;

  begin
    insert into public.offers (order_id, trip_id, traveler_id, amount, weight_kg, handover, hub_id, message)
    values (p_order_id, p_trip_id, v_uid, round(p_amount, 2), round(p_weight_kg, 2), p_handover,
            case when p_handover = 'hub' then p_hub_id end, nullif(btrim(p_message), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'you already have an open offer on this order' using errcode = 'P0001';
  end;

  insert into public.offer_events (offer_id, actor, action, amount) values (v_id, 'traveler', 'offer', round(p_amount, 2));

  perform public.notify(
    v_order.shopper_id, 'offer_new', 'New offer on your order',
    format('A traveler from %s offers to bring "%s" for %s %s.', v_trip.origin_city, v_order.title, round(p_amount, 2), v_order.currency),
    '/orders/' || v_order.id
  );
  return v_id;
end;
$$;

-- p_action: 'accept' | 'counter' | 'decline' | 'withdraw'
create or replace function public.respond_offer(
  p_offer_id uuid,
  p_action   text,
  p_amount   numeric default null
)
returns public.offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_offer  public.offers;
  v_order  public.orders;
  v_trip   public.trips;
  v_me     public.offer_party;
  v_other  uuid;
  v_link   text;
  v_live   record;
  v_weight numeric;
  v_fee    numeric;
  v_payer  text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then raise exception 'offer not found' using errcode = 'P0002'; end if;
  select * into v_order from public.orders where id = v_offer.order_id for update;

  if v_uid = v_order.shopper_id then
    v_me := 'shopper'; v_other := v_offer.traveler_id;
  elsif v_uid = v_offer.traveler_id then
    v_me := 'traveler'; v_other := v_order.shopper_id;
  else
    raise exception 'not your offer' using errcode = '42501';
  end if;
  v_link := '/orders/' || v_order.id;

  -- Traveler backs out after acceptance but before the shopper paid.
  if p_action = 'withdraw' and v_me = 'traveler' and v_offer.status = 'ACCEPTED' then
    if v_order.status <> 'AWAITING_PAYMENT_HOLD' then
      raise exception 'the shopper has already paid; contact support to cancel' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.escrow_transactions where order_id = v_order.id and status in ('PENDING_PAYMENT', 'HELD')) then
      raise exception 'a payment is in progress for this order' using errcode = 'P0001';
    end if;
    update public.offers set status = 'WITHDRAWN' where id = v_offer.id returning * into v_offer;
    update public.orders
      set status = 'SEARCHING_TRAVELER', traveler_id = null, trip_id = null, accepted_offer_id = null,
          agreed_reward = null, weight_kg = null, handover = null, hub_id = null
      where id = v_order.id;
    insert into public.offer_events (offer_id, actor, action) values (v_offer.id, 'traveler', 'withdraw');
    perform public.notify(v_other, 'offer_withdrawn', 'Traveler withdrew',
      format('"%s" is open for offers again.', v_order.title), v_link);
    return v_offer;
  end if;

  if v_offer.status <> 'PENDING' then
    raise exception 'this offer is closed' using errcode = 'P0001';
  end if;
  if v_order.status <> 'SEARCHING_TRAVELER' then
    raise exception 'this order is no longer taking offers' using errcode = 'P0001';
  end if;

  if p_action = 'withdraw' then
    if v_me <> 'traveler' then raise exception 'only the traveler can withdraw' using errcode = '42501'; end if;
    update public.offers set status = 'WITHDRAWN' where id = v_offer.id returning * into v_offer;
    insert into public.offer_events (offer_id, actor, action) values (v_offer.id, v_me, 'withdraw');
    perform public.notify(v_other, 'offer_withdrawn', 'Offer withdrawn',
      format('A traveler withdrew their offer on "%s".', v_order.title), v_link);
    return v_offer;
  end if;

  if v_offer.awaiting <> v_me then
    raise exception 'waiting for the other side to respond' using errcode = 'P0001';
  end if;

  if p_action = 'decline' then
    update public.offers set status = 'DECLINED' where id = v_offer.id returning * into v_offer;
    insert into public.offer_events (offer_id, actor, action) values (v_offer.id, v_me, 'decline');
    perform public.notify(v_other, 'offer_declined', 'Offer declined',
      format('The %s declined the offer on "%s".', v_me, v_order.title), v_link);

  elsif p_action = 'counter' then
    if p_amount is null or p_amount < 0 or p_amount > 100000000 then
      raise exception 'enter a valid reward' using errcode = '22023';
    end if;
    if v_order.currency = 'LBP' and p_amount <> trunc(p_amount) then
      raise exception 'LBP rewards must be whole numbers' using errcode = '22023';
    end if;
    if round(p_amount, 2) = v_offer.amount then
      raise exception 'that is the current amount; accept it instead' using errcode = '22023';
    end if;
    update public.offers
      set amount = round(p_amount, 2),
          awaiting = case when v_me = 'shopper' then 'traveler'::public.offer_party else 'shopper'::public.offer_party end
      where id = v_offer.id
      returning * into v_offer;
    insert into public.offer_events (offer_id, actor, action, amount) values (v_offer.id, v_me, 'counter', v_offer.amount);
    perform public.notify(v_other, 'offer_counter', 'New counter-offer',
      format('The %s proposes %s %s for "%s".', v_me, v_offer.amount, v_order.currency, v_order.title), v_link);

  elsif p_action = 'accept' then
    select * into v_trip from public.trips where id = v_offer.trip_id for update;
    if v_trip.status <> 'OPEN' then
      raise exception 'the traveler''s trip is closed' using errcode = 'P0001';
    end if;
    v_weight := coalesce(v_offer.weight_kg, v_order.weight_kg, 0);
    if v_weight > v_trip.capacity_kg - public.trip_committed_kg(v_trip.id) then
      raise exception 'the traveler no longer has space for this order' using errcode = 'P0001';
    end if;

    update public.offers set status = 'ACCEPTED' where id = v_offer.id returning * into v_offer;
    insert into public.offer_events (offer_id, actor, action, amount) values (v_offer.id, v_me, 'accept', v_offer.amount);

    -- The traveler's weight now counts against their trip.
    update public.orders
      set status = 'AWAITING_PAYMENT_HOLD',
          traveler_id = v_offer.traveler_id,
          trip_id = v_offer.trip_id,
          accepted_offer_id = v_offer.id,
          agreed_reward = v_offer.amount,
          weight_kg = nullif(v_weight, 0),
          handover = v_offer.handover,
          hub_id = v_offer.hub_id
      where id = v_order.id;

    for v_live in
      update public.offers set status = 'DECLINED'
      where order_id = v_order.id and status = 'PENDING' and id <> v_offer.id
      returning id, traveler_id
    loop
      insert into public.offer_events (offer_id, action) values (v_live.id, 'decline');
      perform public.notify(v_live.traveler_id, 'offer_declined', 'Order taken',
        format('"%s" went to another traveler.', v_order.title), v_link);
    end loop;

    select case when v_order.currency = 'LBP' then service_fee_lbp else service_fee_usd end, fee_payer
      into v_fee, v_payer
      from public.app_settings where id;
    perform public.notify(v_order.shopper_id, 'offer_accepted', 'Deal agreed: pay to lock it in',
      format('Place %s %s in Whish escrow so the traveler can buy "%s".',
             v_order.item_total + v_offer.amount + case when coalesce(v_payer, 'shopper') = 'shopper' then coalesce(v_fee, 0) else 0 end,
             v_order.currency, v_order.title), v_link);
    perform public.notify(v_offer.traveler_id, 'offer_accepted', 'Deal agreed',
      format('Waiting for the shopper to pay into escrow for "%s". Don''t buy it until then.', v_order.title), v_link);

  else
    raise exception 'action must be accept, counter, decline or withdraw' using errcode = '22023';
  end if;

  return v_offer;
end;
$$;

-- ---------- 7. Proof of purchase (Story 3.1) --------------------------------
create table public.order_proofs (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  kind       text not null check (kind in ('item', 'receipt')),
  path       text not null,
  created_at timestamptz not null default now()
);
create index order_proofs_order_idx on public.order_proofs (order_id, created_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-proofs', 'order-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- order-proofs/{order_id}/... — the order's traveler uploads; both sides and admins read.
create policy "order proofs: traveler uploads"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'order-proofs' and public.is_order_traveler((storage.foldername(name))[1]));

create policy "order proofs: parties read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'order-proofs'
    and (public.is_order_party((storage.foldername(name))[1]) or public.is_admin())
  );

create or replace function public.submit_proof(
  p_order_id      uuid,
  p_item_paths    text[],
  p_receipt_paths text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_trip  public.trips;
  v_path  text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.traveler_id is distinct from auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status <> 'PURCHASING' then
    raise exception 'proof can only be sent after payment is held and before the trip' using errcode = 'P0001';
  end if;
  if v_order.proof_status = 'approved' then
    raise exception 'the shopper already approved the proof' using errcode = 'P0001';
  end if;

  select * into v_trip from public.trips where id = v_order.trip_id;
  if v_trip.travel_date < current_date then
    raise exception 'proof must be uploaded before your flight on %', v_trip.travel_date using errcode = 'P0001';
  end if;

  if coalesce(array_length(p_item_paths, 1), 0) < 1 or coalesce(array_length(p_receipt_paths, 1), 0) < 1 then
    raise exception 'add at least one photo of the item and one of the receipt' using errcode = '22023';
  end if;
  if array_length(p_item_paths, 1) + array_length(p_receipt_paths, 1) > 8 then
    raise exception 'up to 8 photos' using errcode = '22023';
  end if;

  foreach v_path in array p_item_paths || p_receipt_paths loop
    if split_part(v_path, '/', 1) <> p_order_id::text
       or not exists (select 1 from storage.objects where bucket_id = 'order-proofs' and name = v_path) then
      raise exception 'photo % was not uploaded', v_path using errcode = 'P0002';
    end if;
  end loop;

  delete from public.order_proofs where order_id = p_order_id;
  insert into public.order_proofs (order_id, kind, path)
    select p_order_id, 'item', unnest(p_item_paths)
    union all
    select p_order_id, 'receipt', unnest(p_receipt_paths);

  update public.orders
    set proof_status = 'submitted', proof_submitted_at = now(), proof_rejection_reason = null
    where id = p_order_id;

  perform public.notify(v_order.shopper_id, 'proof_submitted', 'Check the item photos',
    format('The traveler bought "%s". Review the photos and receipt.', v_order.title), '/orders/' || p_order_id);
end;
$$;

-- Creates the secret for the handover: a 6-digit code for the shopper, or a
-- QR token for the traveler to show at the hub.
create table public.handover_otps (
  order_id   uuid primary key references public.orders (id) on delete cascade,
  code       text not null check (code ~ '^[0-9]{6}$'),
  attempts   integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.hub_tokens (
  order_id   uuid primary key references public.orders (id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);

create or replace function public.issue_handover_secret(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if coalesce(v_order.handover, 'in_person') = 'hub' then
    insert into public.hub_tokens (order_id, token)
    values (p_order_id, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    on conflict (order_id) do update set token = excluded.token, created_at = now();
  else
    insert into public.handover_otps (order_id, code)
    values (p_order_id, public.random_code6())
    on conflict (order_id) do update set code = excluded.code, attempts = 0, created_at = now();
  end if;
end;
$$;

create or replace function public.review_proof(
  p_order_id uuid,
  p_approve  boolean,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.shopper_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status <> 'PURCHASING' or v_order.proof_status <> 'submitted' then
    raise exception 'there is no proof waiting for review' using errcode = 'P0001';
  end if;

  if p_approve then
    update public.orders
      set proof_status = 'approved', proof_approved_at = now(), status = 'IN_TRANSIT'
      where id = p_order_id;
    perform public.issue_handover_secret(p_order_id);
    perform public.notify(v_order.traveler_id, 'proof_approved', 'Proof approved: safe travels',
      case when coalesce(v_order.handover, 'in_person') = 'hub'
        then format('Drop "%s" at the hub and show your QR code to get paid.', v_order.title)
        else format('At the handover, ask the shopper for their 6-digit code to get paid for "%s".', v_order.title)
      end, '/orders/' || p_order_id);
  else
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'tell the traveler what is wrong' using errcode = '22023';
    end if;
    update public.orders
      set proof_status = 'rejected', proof_rejection_reason = btrim(p_reason)
      where id = p_order_id;
    perform public.notify(v_order.traveler_id, 'proof_rejected', 'New photos needed',
      format('The shopper asks: %s', btrim(p_reason)), '/orders/' || p_order_id);
  end if;
end;
$$;

-- ---------- 8. OTP handover (Story 3.2) -------------------------------------
create or replace function public.release_for_order(p_order_id uuid, p_method text, p_actor uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_escrow uuid;
begin
  select id into v_escrow from public.escrow_transactions
  where order_id = p_order_id and status = 'HELD'
  for update;
  if v_escrow is null then
    raise exception 'no payment is held for this order' using errcode = 'P0001';
  end if;
  perform public.escrow_transition(v_escrow, 'RELEASED', 'user', p_actor, p_reason, jsonb_build_object('method', p_method));
end;
$$;

-- Traveler enters the shopper's code. Returns 'released', 'wrong_code' or 'locked'.
create or replace function public.confirm_handover(p_order_id uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_otp   public.handover_otps;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.traveler_id is distinct from auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status <> 'IN_TRANSIT' or coalesce(v_order.handover, 'in_person') <> 'in_person' then
    raise exception 'this order is not waiting for an in-person handover' using errcode = 'P0001';
  end if;

  select * into v_otp from public.handover_otps where order_id = p_order_id for update;
  if not found then
    raise exception 'ask the shopper to open the order to get a code' using errcode = 'P0001';
  end if;
  if v_otp.attempts >= 5 then
    return 'locked';
  end if;

  if btrim(coalesce(p_code, '')) <> v_otp.code then
    update public.handover_otps set attempts = attempts + 1 where order_id = p_order_id;
    if v_otp.attempts + 1 >= 5 then
      perform public.notify(v_order.shopper_id, 'handover_locked', 'Handover code locked',
        format('Too many wrong codes were tried for "%s". Open the order to make a new code.', v_order.title),
        '/orders/' || p_order_id);
      return 'locked';
    end if;
    return 'wrong_code';
  end if;

  perform public.release_for_order(p_order_id, 'otp', auth.uid(), 'Handover confirmed with the shopper''s code');
  delete from public.handover_otps where order_id = p_order_id;
  update public.orders set delivered_via = 'in_person', delivered_at = now() where id = p_order_id;
  perform public.notify(v_order.shopper_id, 'handover_done', 'Handover complete',
    format('Enjoy "%s". The traveler has been paid.', v_order.title), '/orders/' || p_order_id);
  return 'released';
end;
$$;

-- Shopper makes a fresh code (e.g. after it locked).
create or replace function public.regenerate_handover_code(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.shopper_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status <> 'IN_TRANSIT' or coalesce(v_order.handover, 'in_person') <> 'in_person' then
    raise exception 'this order is not waiting for an in-person handover' using errcode = 'P0001';
  end if;
  perform public.issue_handover_secret(p_order_id);
end;
$$;

-- ---------- 9. Hub drop-off with QR (Story 3.3) -----------------------------
create or replace function public.hub_lookup(p_token text)
returns table (
  order_id      uuid,
  title         text,
  image_url     text,
  status        public.order_status,
  traveler_name text,
  hub_id        uuid,
  hub_name      text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select o.* into v_order
  from public.hub_tokens t join public.orders o on o.id = t.order_id
  where t.token = p_token;
  if not found then
    raise exception 'this QR code is not valid or was already used' using errcode = 'P0002';
  end if;
  if not public.is_hub_operator(v_order.hub_id) then
    raise exception 'only staff of this hub can scan this code' using errcode = '42501';
  end if;
  return query
    select v_order.id, v_order.title, v_order.image_url, v_order.status,
           (select pp.display_name from public.public_profiles(array[v_order.traveler_id]) pp),
           h.id, h.name
    from public.hubs h where h.id = v_order.hub_id;
end;
$$;

create or replace function public.hub_confirm_dropoff(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_hub   public.hubs;
begin
  select o.* into v_order
  from public.hub_tokens t join public.orders o on o.id = t.order_id
  where t.token = p_token
  for update of o;
  if not found then
    raise exception 'this QR code is not valid or was already used' using errcode = 'P0002';
  end if;
  if not public.is_hub_operator(v_order.hub_id) then
    raise exception 'only staff of this hub can scan this code' using errcode = '42501';
  end if;
  if v_order.status <> 'IN_TRANSIT' then
    raise exception 'this order is not on its way to a hub' using errcode = 'P0001';
  end if;

  perform public.release_for_order(v_order.id, 'hub_qr', auth.uid(), 'Dropped off at the hub');
  delete from public.hub_tokens where order_id = v_order.id;
  update public.orders
    set delivered_via = 'hub', delivered_at = now(), hub_dropoff_at = now()
    where id = v_order.id;

  select * into v_hub from public.hubs where id = v_order.hub_id;
  perform public.notify(v_order.shopper_id, 'hub_ready', 'Ready for pickup',
    format('"%s" is waiting for you at %s (%s).', v_order.title, v_hub.name, v_hub.area), '/orders/' || v_order.id);
  return v_order.id;
end;
$$;

-- ---------- 10. Privileges & RLS ---------------------------------------------
alter table public.app_settings   enable row level security;
alter table public.hubs           enable row level security;
alter table public.hub_operators  enable row level security;
alter table public.order_proofs   enable row level security;
alter table public.handover_otps  enable row level security;
alter table public.hub_tokens     enable row level security;

revoke insert, update, delete on public.app_settings, public.hubs, public.hub_operators,
  public.order_proofs, public.handover_otps, public.hub_tokens from anon, authenticated;

create policy "settings: read" on public.app_settings for select to authenticated using (true);
create policy "hubs: read" on public.hubs for select to authenticated using (is_active or public.is_admin());
create policy "hub operators: own or admin" on public.hub_operators for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy "order proofs: parties read" on public.order_proofs for select to authenticated
  using (public.is_order_party(order_id::text) or public.is_admin());
-- The code is the shopper's alone; the QR token is the traveler's alone.
create policy "handover code: shopper only" on public.handover_otps for select to authenticated
  using (public.owns_order(order_id));
create policy "hub token: traveler only" on public.hub_tokens for select to authenticated
  using (public.is_order_traveler(order_id::text));
-- Hub staff see orders heading to their hub.
create policy "orders: hub staff read" on public.orders for select to authenticated
  using (hub_id is not null and public.is_hub_operator(hub_id));

revoke execute on function public.escrow_apply_fee() from public, anon, authenticated;
revoke execute on function public.random_code6() from public, anon, authenticated;
revoke execute on function public.issue_handover_secret(uuid) from public, anon, authenticated;
revoke execute on function public.release_for_order(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.make_offer(uuid, uuid, numeric, numeric, public.handover_method, uuid, text) from public, anon;
revoke execute on function public.submit_proof(uuid, text[], text[]) from public, anon;
revoke execute on function public.review_proof(uuid, boolean, text) from public, anon;
revoke execute on function public.confirm_handover(uuid, text) from public, anon;
revoke execute on function public.regenerate_handover_code(uuid) from public, anon;
revoke execute on function public.hub_lookup(text) from public, anon;
revoke execute on function public.hub_confirm_dropoff(text) from public, anon;
grant execute on function public.make_offer(uuid, uuid, numeric, numeric, public.handover_method, uuid, text) to authenticated;
grant execute on function public.submit_proof(uuid, text[], text[]) to authenticated;
grant execute on function public.review_proof(uuid, boolean, text) to authenticated;
grant execute on function public.confirm_handover(uuid, text) to authenticated;
grant execute on function public.regenerate_handover_code(uuid) to authenticated;
grant execute on function public.hub_lookup(text) to authenticated;
grant execute on function public.hub_confirm_dropoff(text) to authenticated;
grant execute on function public.is_hub_operator(uuid) to authenticated;
grant execute on function public.is_order_party(text) to authenticated;
grant execute on function public.is_order_traveler(text) to authenticated;
