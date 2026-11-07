-- Sprint 2 database tests: orders, trips, matching, offers, notifications.
-- Runs in a transaction and rolls back.
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/sprint2.sql
-- Every line should end in |t or print a NOTICE "ok". Any failure stops the run.
-- Requires migrations 1–4.
\set ON_ERROR_STOP on
begin;

-- S = shopper, T = traveler, T2 = second traveler, U = unverified user
insert into auth.users (id, phone, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-00000000000a', '96170000001', '{"full_name":"Maya Khoury"}'),
  ('b0000000-0000-0000-0000-00000000000b', '96170000002', '{"full_name":"Rami Abou Haddad"}'),
  ('c0000000-0000-0000-0000-00000000000c', '96170000003', '{"full_name":"Nour"}'),
  ('d0000000-0000-0000-0000-00000000000d', '96170000004', '{}');
update public.profiles set kyc_status = 'verified'
  where id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000c');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;

-- ---------- Unverified user ----------
set role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-00000000000d', true);
do $$ begin
  insert into public.orders (title, item_price, origin_country, reward_amount)
  values ('Nike Air Max 90', 120, 'AE', 20);
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T1 ok: unverified user cannot post an order';
end $$;

-- ---------- Shopper posts ----------
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
do $$ begin
  insert into public.orders (title, item_price, origin_country, reward_amount, status)
  values ('Hack', 1, 'AE', 0, 'PURCHASING');
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T2 ok: shopper cannot set order status';
end $$;
do $$ begin
  insert into public.orders (title, item_price, origin_country, reward_amount)
  values ('Local', 10, 'LB', 5);
  raise exception 'SHOULD NOT REACH';
exception when check_violation then raise notice 'T3 ok: origin cannot be Lebanon';
end $$;

with x as (
  insert into public.orders (item_url, title, item_price, quantity, origin_country, reward_amount)
  values ('https://www.amazon.ae/dp/B0TEST', 'AirPods Pro 2', 100, 2, 'AE', 20)
  returning id
) insert into ids select 'order1', id from x;
select 'T4 order posted' as test,
  status = 'SEARCHING_TRAVELER' and item_total = 200 and shopper_id = 'a0000000-0000-0000-0000-00000000000a' as ok
  from public.orders where id = (select v from ids where k = 'order1');

-- ---------- Traveler adds a trip ----------
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
do $$ begin
  insert into public.trips (origin_country, origin_city, travel_date, capacity_kg) values ('AE', 'Dubai', current_date - 1, 10);
  raise exception 'SHOULD NOT REACH';
exception when invalid_parameter_value then raise notice 'T5 ok: trip in the past rejected';
end $$;
with x as (
  insert into public.trips (origin_country, origin_city, travel_date, capacity_kg)
  values ('AE', 'Dubai', current_date + 5, 10) returning id
) insert into ids select 'tripT', id from x;
select 'T6 traveler sees open order' as test, count(*) = 1 as ok from public.orders;
select 'T7 matching finds it' as test, count(*) = 1 as ok from public.matching_orders((select v from ids where k = 'tripT'));

-- Turkish trip should not match an Emirati order
with x as (
  insert into public.trips (origin_country, origin_city, travel_date, capacity_kg)
  values ('TR', 'Istanbul', current_date + 3, 10) returning id
) insert into ids select 'tripTR', id from x;
select 'T8 other route does not match' as test, count(*) = 0 as ok from public.matching_orders((select v from ids where k = 'tripTR'));
do $$ begin
  perform public.make_offer((select v from ids where k = 'order1'), (select v from ids where k = 'tripTR'), 20, 2);
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T9 ok: cannot offer from the wrong country';
end $$;

-- Offer at the shopper's reward
insert into ids select 'offerT', public.make_offer((select v from ids where k = 'order1'), (select v from ids where k = 'tripT'), 20, 2, 'in_person', null, 'Landing Friday');
do $$ begin
  perform public.make_offer((select v from ids where k = 'order1'), (select v from ids where k = 'tripT'), 25, 2);
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T10 ok: one open offer per traveler';
end $$;
do $$ begin
  perform public.respond_offer((select v from ids where k = 'offerT'), 'counter', 30);
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T11 ok: traveler must wait for shopper';
end $$;

-- ---------- Shopper counters ----------
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
select 'T12 shopper notified of offer' as test, count(*) = 1 and bool_and(kind = 'offer_new') as ok from public.notifications;
select 'T13 shopper sees offer + trip' as test,
  (select count(*) from public.offers) = 1 and (select origin_city from public.trips) = 'Dubai' as ok;
select 'T14 public profile name' as test, display_name = 'Rami H.' and verified as ok
  from public.public_profiles(array['b0000000-0000-0000-0000-00000000000b'::uuid]);
select (public.respond_offer((select v from ids where k = 'offerT'), 'counter', 15)).awaiting = 'traveler' as countered;

-- ---------- Second traveler bids ----------
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-00000000000c', true);
with x as (
  insert into public.trips (origin_country, origin_city, travel_date, capacity_kg)
  values ('AE', 'Abu Dhabi', current_date + 2, 5) returning id
) insert into ids select 'tripT2', id from x;
insert into ids select 'offerT2', public.make_offer((select v from ids where k = 'order1'), (select v from ids where k = 'tripT2'), 18, 1.5);
select 'T15 traveler sees only own offers' as test, count(*) = 1 as ok from public.offers;

-- ---------- Traveler accepts the counter ----------
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
select 'T16 traveler notified of counter' as test, count(*) = 1 as ok from public.notifications where kind = 'offer_counter';
select (public.respond_offer((select v from ids where k = 'offerT'), 'accept')).status = 'ACCEPTED' as accepted;
select 'T17 order locked' as test,
  status = 'AWAITING_PAYMENT_HOLD' and agreed_reward = 15 and traveler_id = 'b0000000-0000-0000-0000-00000000000b'
  and trip_id = (select v from ids where k = 'tripT') and weight_kg = 2 as ok
  from public.orders where id = (select v from ids where k = 'order1');
select 'T18 committed kg' as test, public.trip_committed_kg((select v from ids where k = 'tripT')) = 2 as ok;
do $$ begin
  update public.trips set capacity_kg = 1 where id = (select v from ids where k = 'tripT');
  raise exception 'SHOULD NOT REACH';
exception when invalid_parameter_value then raise notice 'T19 ok: capacity cannot drop below promised kg';
end $$;

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-00000000000c', true);
select 'T20 losing offer declined + notified' as test,
  (select status from public.offers) = 'DECLINED'
  and (select count(*) from public.notifications where kind = 'offer_declined') = 1 as ok;
do $$ begin
  perform public.respond_offer((select v from ids where k = 'offerT2'), 'counter', 10);
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T21 ok: closed offer cannot be countered';
end $$;
select 'T22 locked order no longer matches' as test, count(*) = 0 as ok from public.matching_orders((select v from ids where k = 'tripT2'));

-- ---------- Payment: escrow drives the order ----------
reset role;
set role service_role;
with x as (
  insert into public.escrow_transactions (order_id, shopper_id, traveler_id, item_amount, reward_amount)
  values ((select v from ids where k = 'order1'), 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b', 200, 15)
  returning id
) insert into ids select 'esc1', id from x;
select (public.escrow_transition((select v from ids where k = 'esc1'), 'HELD', 'whish')).status;
select 'T23 HELD → order PURCHASING + traveler told to buy' as test,
  (select status from public.orders where id = (select v from ids where k = 'order1')) = 'PURCHASING'
  and (select count(*) from public.notifications where kind = 'payment_held' and user_id = 'b0000000-0000-0000-0000-00000000000b') = 1 as ok;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
do $$ begin
  perform public.cancel_order((select v from ids where k = 'order1'));
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T24 ok: cannot cancel once money is held';
end $$;

reset role;
set role service_role;
select (public.escrow_transition((select v from ids where k = 'esc1'), 'RELEASED', 'admin')).status;
select 'T25 RELEASED → order DELIVERED' as test, status = 'DELIVERED' as ok
  from public.orders where id = (select v from ids where k = 'order1');

-- ---------- Accept directly, then traveler backs out ----------
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
with x as (
  insert into public.orders (title, item_price, origin_country, reward_amount, needed_by)
  values ('Kindle Paperwhite', 150, 'AE', 25, current_date + 30) returning id
) insert into ids select 'order2', id from x;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
insert into ids select 'offer2', public.make_offer((select v from ids where k = 'order2'), (select v from ids where k = 'tripT'), 25, 0.5);
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
select (public.respond_offer((select v from ids where k = 'offer2'), 'accept')).status as shopper_accepts;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
select (public.respond_offer((select v from ids where k = 'offer2'), 'withdraw')).status as traveler_withdraws;
select 'T26 order reopened' as test,
  status = 'SEARCHING_TRAVELER' and traveler_id is null and accepted_offer_id is null as ok
  from public.orders where id = (select v from ids where k = 'order2');

-- ---------- Shopper cancels ----------
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-00000000000c', true);
insert into ids select 'offer3', public.make_offer((select v from ids where k = 'order2'), (select v from ids where k = 'tripT2'), 30, 0.5);
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
select public.cancel_order((select v from ids where k = 'order2'));
select 'T27 cancelled, open offer closed' as test,
  (select status from public.orders where id = (select v from ids where k = 'order2')) = 'CANCELLED'
  and (select status from public.offers where id = (select v from ids where k = 'offer3')) = 'DECLINED' as ok;

-- ---------- Notifications ----------
update public.notifications set read_at = now();
select 'T28 mark read' as test, bool_and(read_at is not null) as ok from public.notifications;
do $$ begin
  update public.notifications set title = 'x';
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T29 ok: cannot rewrite notifications';
end $$;

-- ---------- Stranger ----------
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-00000000000d', true);
select 'T30 stranger sees no deals, trips or closed orders' as test,
  (select count(*) from public.offers) = 0
  and (select count(*) from public.trips) = 0
  and (select count(*) from public.orders) = 0
  and (select count(*) from public.notifications) = 0 as ok;
do $$ begin
  perform public.notify('d0000000-0000-0000-0000-00000000000d', 'x', 'spoof');
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T31 ok: users cannot create notifications';
end $$;

rollback;
