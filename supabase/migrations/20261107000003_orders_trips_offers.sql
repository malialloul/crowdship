-- =============================================================================
-- Sprint 2 — Orders, trips, matching, offers & counter-offers, notifications
-- =============================================================================
--
-- Order:  SEARCHING_TRAVELER ──accept offer──► AWAITING_PAYMENT_HOLD ──Whish HELD──► PURCHASING
--            │                                        │                                 │
--            └──cancel──► CANCELLED ◄──cancel─────────┘                    (Sprint 3) IN_TRANSIT ──► DELIVERED
--
-- Offer:  PENDING (awaiting shopper ⇄ traveler while countering) ──► ACCEPTED | DECLINED | WITHDRAWN
--
-- Users insert orders and trips directly (RLS + column grants). Everything that
-- changes state goes through SECURITY DEFINER functions below.

create type public.order_status as enum
  ('SEARCHING_TRAVELER', 'AWAITING_PAYMENT_HOLD', 'PURCHASING', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');
create type public.trip_status  as enum ('OPEN', 'CLOSED', 'CANCELLED');
create type public.offer_status as enum ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');
create type public.offer_party  as enum ('shopper', 'traveler');

-- ---------- Helpers ----------------------------------------------------------
create or replace function public.is_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and kyc_status = 'verified'
  );
$$;

-- ---------- Notifications ----------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

create or replace function public.notify(
  p_user  uuid,
  p_kind  text,
  p_title text,
  p_body  text default null,
  p_link  text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  values (p_user, p_kind, p_title, p_body, p_link);
$$;

-- ---------- Trips ------------------------------------------------------------
create table public.trips (
  id               uuid primary key default gen_random_uuid(),
  traveler_id      uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  origin_country   text not null check (origin_country ~ '^[A-Z]{2}$' and origin_country <> 'LB'),
  origin_city      text not null check (char_length(btrim(origin_city)) between 2 and 80),
  destination_city text not null default 'Beirut' check (destination_city = 'Beirut'),
  travel_date      date not null,
  capacity_kg      numeric(5, 1) not null check (capacity_kg > 0 and capacity_kg <= 50),
  notes            text check (char_length(notes) <= 500),
  status           public.trip_status not null default 'OPEN',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index trips_traveler_idx on public.trips (traveler_id, travel_date desc);
create index trips_match_idx    on public.trips (origin_country, travel_date) where status = 'OPEN';

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

-- ---------- Orders -----------------------------------------------------------
create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  shopper_id        uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  item_url          text check (item_url is null or (item_url ~* '^https?://' and char_length(item_url) <= 2000)),
  title             text not null check (char_length(btrim(title)) between 3 and 200),
  description       text check (char_length(description) <= 2000),
  image_url         text check (image_url is null or (image_url ~* '^https://' and char_length(image_url) <= 2000)),
  item_price        numeric(14, 2) not null check (item_price > 0),
  quantity          integer not null default 1 check (quantity between 1 and 20),
  item_total        numeric(14, 2) generated always as (item_price * quantity) stored,
  currency          public.escrow_currency not null default 'USD',
  weight_kg         numeric(5, 2) not null check (weight_kg > 0 and weight_kg <= 32),
  origin_country    text not null check (origin_country ~ '^[A-Z]{2}$' and origin_country <> 'LB'),
  reward_amount     numeric(14, 2) not null check (reward_amount >= 0),
  needed_by         date,
  status            public.order_status not null default 'SEARCHING_TRAVELER',
  traveler_id       uuid references public.profiles (id) on delete restrict,
  trip_id           uuid references public.trips (id) on delete restrict,
  accepted_offer_id uuid,
  agreed_reward     numeric(14, 2),
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint orders_lbp_whole check (currency <> 'LBP' or (item_price = trunc(item_price) and reward_amount = trunc(reward_amount))),
  constraint orders_assigned check (
    status in ('SEARCHING_TRAVELER', 'CANCELLED')
    or (traveler_id is not null and trip_id is not null and accepted_offer_id is not null and agreed_reward is not null)
  )
);

create index orders_shopper_idx  on public.orders (shopper_id, created_at desc);
create index orders_traveler_idx on public.orders (traveler_id, created_at desc);
create index orders_match_idx    on public.orders (origin_country, created_at desc) where status = 'SEARCHING_TRAVELER';

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------- Offers -----------------------------------------------------------
create table public.offers (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  trip_id     uuid not null references public.trips (id) on delete restrict,
  traveler_id uuid not null references public.profiles (id) on delete restrict,
  amount      numeric(14, 2) not null check (amount >= 0),     -- current reward on the table
  awaiting    public.offer_party not null default 'shopper',    -- whose move it is
  status      public.offer_status not null default 'PENDING',
  message     text check (char_length(message) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index offers_order_idx    on public.offers (order_id, created_at);
create index offers_traveler_idx on public.offers (traveler_id, created_at desc);
create unique index offers_one_live_per_traveler on public.offers (order_id, traveler_id) where status = 'PENDING';
create unique index offers_one_accepted_per_order on public.offers (order_id) where status = 'ACCEPTED';

create trigger offers_set_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

alter table public.orders
  add constraint orders_accepted_offer_id_fkey foreign key (accepted_offer_id) references public.offers (id) on delete restrict;

-- Negotiation history.
create table public.offer_events (
  id         bigint generated always as identity primary key,
  offer_id   uuid not null references public.offers (id) on delete cascade,
  actor      public.offer_party,              -- null = system
  action     text not null check (action in ('offer', 'counter', 'accept', 'decline', 'withdraw')),
  amount     numeric(14, 2),
  created_at timestamptz not null default now()
);

create index offer_events_offer_idx on public.offer_events (offer_id, created_at);

-- Escrow rows now belong to orders.
alter table public.escrow_transactions
  add constraint escrow_transactions_order_id_fkey foreign key (order_id) references public.orders (id) on delete restrict not valid;

-- ---------- Visibility helpers (SECURITY DEFINER avoids RLS recursion) ------
create or replace function public.owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.orders where id = p_order_id and shopper_id = (select auth.uid()));
$$;

create or replace function public.has_offer_on(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.offers where order_id = p_order_id and traveler_id = (select auth.uid()));
$$;

-- A shopper may see the trip behind an offer on their order.
create or replace function public.can_see_trip(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.offers o
    join public.orders r on r.id = o.order_id
    where o.trip_id = p_trip_id and r.shopper_id = (select auth.uid())
  );
$$;

-- Kilos already promised on a trip.
create or replace function public.trip_committed_kg(p_trip_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(weight_kg), 0)
  from public.orders
  where trip_id = p_trip_id and status <> 'CANCELLED';
$$;

-- Name, picture and badge only — safe to show the other side of a deal.
create or replace function public.public_profiles(p_ids uuid[])
returns table (id uuid, display_name text, avatar_url text, verified boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    case
      when coalesce(btrim(p.full_name), '') = '' then 'Member'
      when strpos(btrim(p.full_name), ' ') = 0 then btrim(p.full_name)
      else split_part(btrim(p.full_name), ' ', 1) || ' '
           || left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1) || '.'
    end,
    p.avatar_url,
    p.kyc_status = 'verified'
  from public.profiles p
  where p.id = any (p_ids);
$$;

-- ---------- Trip rules -------------------------------------------------------
create or replace function public.trips_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.travel_date < current_date or new.travel_date > current_date + 365 then
      raise exception 'travel date must be between today and one year from now' using errcode = '22023';
    end if;
  elsif new.capacity_kg < old.capacity_kg
        and new.capacity_kg < public.trip_committed_kg(new.id) then
    raise exception 'capacity is lower than the % kg already promised on this trip', public.trip_committed_kg(new.id)
      using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.status = 'CANCELLED' and new.status <> 'CANCELLED' then
    raise exception 'a cancelled trip cannot be reopened' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trips_validate
  before insert or update on public.trips
  for each row execute function public.trips_validate();

-- ---------- Matching (Story 2.2) ---------------------------------------------
-- Open orders from the trip's country that fit the space left and are needed
-- on or after the travel date. Runs as the caller, so RLS still applies.
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
   and o.weight_kg <= t.capacity_kg - public.trip_committed_kg(t.id)
   and (o.needed_by is null or o.needed_by >= t.travel_date)
  where t.id = p_trip_id
    and t.traveler_id = (select auth.uid())
    and t.status = 'OPEN'
  order by o.created_at desc
  limit 100;
$$;

-- ---------- Offers & counter-offers (Story 2.3) ------------------------------
create or replace function public.make_offer(
  p_order_id uuid,
  p_trip_id  uuid,
  p_amount   numeric,
  p_message  text default null
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
  if v_order.weight_kg > v_trip.capacity_kg - public.trip_committed_kg(v_trip.id) then
    raise exception 'not enough space left on this trip' using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount < 0 or p_amount > 100000000 then
    raise exception 'enter a valid reward' using errcode = '22023';
  end if;
  if v_order.currency = 'LBP' and p_amount <> trunc(p_amount) then
    raise exception 'LBP rewards must be whole numbers' using errcode = '22023';
  end if;

  begin
    insert into public.offers (order_id, trip_id, traveler_id, amount, message)
    values (p_order_id, p_trip_id, v_uid, round(p_amount, 2), nullif(btrim(p_message), ''))
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
  v_uid   uuid := auth.uid();
  v_offer public.offers;
  v_order public.orders;
  v_trip  public.trips;
  v_me    public.offer_party;
  v_other uuid;
  v_link  text;
  v_live  record;
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
      set status = 'SEARCHING_TRAVELER', traveler_id = null, trip_id = null, accepted_offer_id = null, agreed_reward = null
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
    if v_order.weight_kg > v_trip.capacity_kg - public.trip_committed_kg(v_trip.id) then
      raise exception 'the traveler no longer has space for this order' using errcode = 'P0001';
    end if;

    update public.offers set status = 'ACCEPTED' where id = v_offer.id returning * into v_offer;
    insert into public.offer_events (offer_id, actor, action, amount) values (v_offer.id, v_me, 'accept', v_offer.amount);

    update public.orders
      set status = 'AWAITING_PAYMENT_HOLD',
          traveler_id = v_offer.traveler_id,
          trip_id = v_offer.trip_id,
          accepted_offer_id = v_offer.id,
          agreed_reward = v_offer.amount
      where id = v_order.id;

    -- Close every other open offer on this order.
    for v_live in
      update public.offers set status = 'DECLINED'
      where order_id = v_order.id and status = 'PENDING' and id <> v_offer.id
      returning id, traveler_id
    loop
      insert into public.offer_events (offer_id, action) values (v_live.id, 'decline');
      perform public.notify(v_live.traveler_id, 'offer_declined', 'Order taken',
        format('"%s" went to another traveler.', v_order.title), v_link);
    end loop;

    perform public.notify(v_order.shopper_id, 'offer_accepted', 'Deal agreed: pay to lock it in',
      format('Place %s %s in Whish escrow so the traveler can buy "%s".',
             v_order.item_total + v_offer.amount, v_order.currency, v_order.title), v_link);
    perform public.notify(v_offer.traveler_id, 'offer_accepted', 'Deal agreed',
      format('Waiting for the shopper to pay into escrow for "%s". Don''t buy it until then.', v_order.title), v_link);

  else
    raise exception 'action must be accept, counter, decline or withdraw' using errcode = '22023';
  end if;

  return v_offer;
end;
$$;

create or replace function public.cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_esc   public.escrow_transactions;
  v_live  record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.shopper_id <> auth.uid() then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status not in ('SEARCHING_TRAVELER', 'AWAITING_PAYMENT_HOLD') then
    raise exception 'money is already held for this order; contact support to cancel' using errcode = 'P0001';
  end if;

  -- An unfinished Whish payment is abandoned with the order.
  for v_esc in select * from public.escrow_transactions where order_id = p_order_id and status in ('PENDING_PAYMENT', 'HELD') loop
    if v_esc.status = 'HELD' then
      raise exception 'money is already held for this order; contact support to cancel' using errcode = 'P0001';
    end if;
    perform public.escrow_transition(v_esc.id, 'CANCELLED', 'user', auth.uid(), 'Order cancelled by shopper');
  end loop;

  update public.orders set status = 'CANCELLED', cancelled_at = now() where id = p_order_id;

  for v_live in
    update public.offers set status = 'DECLINED'
    where order_id = p_order_id and status in ('PENDING', 'ACCEPTED')
    returning id, traveler_id
  loop
    insert into public.offer_events (offer_id, actor, action) values (v_live.id, 'shopper', 'decline');
    perform public.notify(v_live.traveler_id, 'order_cancelled', 'Order cancelled',
      format('The shopper cancelled "%s".', v_order.title), '/orders/' || p_order_id);
  end loop;
end;
$$;

-- ---------- Keep orders in step with escrow ----------------------------------
create or replace function public.escrow_sync_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if new.order_id is null or new.status = old.status then
    return new;
  end if;
  select * into v_order from public.orders where id = new.order_id;

  if new.status = 'HELD' then
    update public.orders set status = 'PURCHASING'
      where id = new.order_id and status = 'AWAITING_PAYMENT_HOLD';
    perform public.notify(new.traveler_id, 'payment_held', 'Payment secured: you can buy the item',
      format('%s %s for "%s" is held in escrow.', new.total_amount, new.currency, v_order.title),
      '/orders/' || new.order_id);
  elsif new.status = 'RELEASED' then
    update public.orders set status = 'DELIVERED'
      where id = new.order_id and status in ('PURCHASING', 'IN_TRANSIT');
    perform public.notify(new.traveler_id, 'payment_released', 'Payment released',
      format('%s %s for "%s" is on its way to your Whish account.', new.total_amount, new.currency, v_order.title),
      '/payments');
  elsif new.status = 'REFUNDED' then
    update public.orders set status = 'CANCELLED', cancelled_at = now()
      where id = new.order_id and status not in ('DELIVERED', 'CANCELLED');
  end if;
  return new;
end;
$$;

create trigger escrow_sync_order
  after update of status on public.escrow_transactions
  for each row execute function public.escrow_sync_order();

-- ---------- Privileges & RLS -------------------------------------------------
alter table public.notifications enable row level security;
alter table public.trips         enable row level security;
alter table public.orders        enable row level security;
alter table public.offers        enable row level security;
alter table public.offer_events  enable row level security;

revoke insert, update, delete on public.notifications, public.trips, public.orders, public.offers, public.offer_events
  from anon, authenticated;

grant insert (item_url, title, description, image_url, item_price, quantity, currency, weight_kg, origin_country, reward_amount, needed_by)
  on public.orders to authenticated;
grant insert (origin_country, origin_city, travel_date, capacity_kg, notes) on public.trips to authenticated;
grant update (capacity_kg, notes, status) on public.trips to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Notifications: your own.
create policy "notifications: own read" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications: own mark read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Orders: open ones are public to signed-in users so travelers can find them.
create policy "orders: read" on public.orders for select to authenticated
  using (
    status = 'SEARCHING_TRAVELER'
    or shopper_id = (select auth.uid())
    or traveler_id = (select auth.uid())
    or public.has_offer_on(id)
    or public.is_admin()
  );
create policy "orders: verified users post" on public.orders for insert to authenticated
  with check (shopper_id = (select auth.uid()) and public.is_verified());

-- Trips: the traveler, shoppers who got an offer from it, admins.
create policy "trips: read" on public.trips for select to authenticated
  using (traveler_id = (select auth.uid()) or public.can_see_trip(id) or public.is_admin());
create policy "trips: verified users add" on public.trips for insert to authenticated
  with check (traveler_id = (select auth.uid()) and public.is_verified());
create policy "trips: owner updates" on public.trips for update to authenticated
  using (traveler_id = (select auth.uid())) with check (traveler_id = (select auth.uid()));

-- Offers: the traveler who made it, the shopper whose order it's on, admins.
create policy "offers: read" on public.offers for select to authenticated
  using (traveler_id = (select auth.uid()) or public.owns_order(order_id) or public.is_admin());
create policy "offer events: read" on public.offer_events for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.offers o
      where o.id = offer_id and (o.traveler_id = (select auth.uid()) or public.owns_order(o.order_id))
    )
  );

-- Functions: callable by signed-in users only; internals by nobody.
revoke execute on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.escrow_sync_order() from public, anon, authenticated;
revoke execute on function public.trips_validate() from public, anon, authenticated;
revoke execute on function public.make_offer(uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.respond_offer(uuid, text, numeric) from public, anon;
revoke execute on function public.cancel_order(uuid) from public, anon;
revoke execute on function public.matching_orders(uuid) from public, anon;
revoke execute on function public.public_profiles(uuid[]) from public, anon;
revoke execute on function public.trip_committed_kg(uuid) from public, anon;
grant execute on function public.make_offer(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.respond_offer(uuid, text, numeric) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.matching_orders(uuid) to authenticated;
grant execute on function public.public_profiles(uuid[]) to authenticated;
grant execute on function public.trip_committed_kg(uuid) to authenticated;
grant execute on function public.is_verified() to authenticated;

-- Live in-app alerts (Story 2.3 AC2).
alter publication supabase_realtime add table public.notifications;
