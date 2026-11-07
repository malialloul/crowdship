-- Sprint 3 database tests: service fee, traveler-set weight, proof of purchase,
-- OTP handover, hub drop-off with QR. Runs in a transaction and rolls back.
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/sprint3.sql
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, phone, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-00000000000a', '96170000001', '{"full_name":"Maya Khoury"}'),   -- shopper
  ('b0000000-0000-0000-0000-00000000000b', '96170000002', '{"full_name":"Rami Haddad"}'),   -- traveler
  ('c0000000-0000-0000-0000-00000000000c', '96170000003', '{"full_name":"Hub Staff"}'),     -- hub operator
  ('d0000000-0000-0000-0000-00000000000d', '96170000004', '{"full_name":"Stranger"}');
update public.profiles set kyc_status = 'verified';

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;
insert into ids select 'hub', id from public.hubs order by name limit 1;

-- ---------- Setup: order, trip ----------
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
do $$ begin
  insert into public.orders (title, item_price, weight_kg, origin_country, reward_amount) values ('x', 10, 1, 'AE', 5);
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T1 ok: shopper cannot set the weight';
end $$;
with x as (insert into public.orders (title, item_price, origin_country, reward_amount) values ('AirPods Pro 2', 200, 'AE', 20) returning id)
insert into ids select 'o1', id from x;
with x as (insert into public.orders (title, item_price, origin_country, reward_amount) values ('Kindle', 100, 'AE', 10) returning id)
insert into ids select 'o2', id from x;
select 'T2 settings readable' as test, service_fee_usd = 1 and fee_payer = 'shopper' as ok from public.app_settings;

select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
with x as (insert into public.trips (origin_country, origin_city, travel_date, capacity_kg) values ('AE', 'Dubai', current_date + 2, 3) returning id)
insert into ids select 'trip', id from x;
select 'T3 weightless orders match' as test, count(*) = 2 as ok from public.matching_orders((select v from ids where k = 'trip'));
do $$ begin
  perform public.make_offer((select v from ids where k = 'o1'), (select v from ids where k = 'trip'), 20, 5);
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T4 ok: weight over the trip''s space rejected';
end $$;
do $$ begin
  perform public.make_offer((select v from ids where k = 'o1'), (select v from ids where k = 'trip'), 20, 1, 'hub', null);
  raise exception 'SHOULD NOT REACH';
exception when invalid_parameter_value then raise notice 'T5 ok: hub drop-off needs a hub';
end $$;
insert into ids select 'of1', public.make_offer((select v from ids where k = 'o1'), (select v from ids where k = 'trip'), 20, 2);
insert into ids select 'of2', public.make_offer((select v from ids where k = 'o2'), (select v from ids where k = 'trip'), 10, 1, 'hub', (select v from ids where k = 'hub'));

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
select (public.respond_offer((select v from ids where k = 'of1'), 'accept')).status as accept1;
select (public.respond_offer((select v from ids where k = 'of2'), 'accept')).status as accept2;
select 'T6 traveler weight deducted from trip' as test,
  public.trip_committed_kg((select v from ids where k = 'trip')) = 3
  and (select weight_kg from public.orders where id = (select v from ids where k = 'o1')) = 2
  and (select handover from public.orders where id = (select v from ids where k = 'o2')) = 'hub' as ok;
select 'T7 accept notification includes the $1 fee' as test, count(*) = 1 as ok
  from public.notifications where kind = 'offer_accepted' and body like '%221.00 USD%';

-- ---------- Payments with fee ----------
reset role;
set role service_role;
with x as (
  insert into public.escrow_transactions (order_id, shopper_id, traveler_id, item_amount, reward_amount)
  values ((select v from ids where k = 'o1'), 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b', 200, 20)
  returning id
) insert into ids select 'e1', id from x;
with x as (
  insert into public.escrow_transactions (order_id, shopper_id, traveler_id, item_amount, reward_amount)
  values ((select v from ids where k = 'o2'), 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b', 100, 10)
  returning id
) insert into ids select 'e2', id from x;
select 'T8 shopper pays item + reward + $1' as test, platform_fee = 1 and total_amount = 221 as ok
  from public.escrow_transactions where id = (select v from ids where k = 'e1');
do $$ begin
  update public.escrow_transactions set platform_fee = 0 where id = (select v from ids where k = 'e1');
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T9 ok: fee is frozen';
end $$;
select (public.escrow_transition((select v from ids where k = 'e1'), 'HELD', 'whish')).status;
select (public.escrow_transition((select v from ids where k = 'e2'), 'HELD', 'whish')).status;

-- ---------- Proof of purchase (3.1) ----------
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-00000000000d', true);
do $$ begin
  insert into storage.objects (bucket_id, name) values ('order-proofs', (select v from ids where k = 'o1')::text || '/fake.jpg');
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T10 ok: stranger cannot upload proof';
end $$;

select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
insert into storage.objects (bucket_id, name) values
  ('order-proofs', (select v from ids where k = 'o1')::text || '/item1.jpg'),
  ('order-proofs', (select v from ids where k = 'o1')::text || '/receipt1.jpg'),
  ('order-proofs', (select v from ids where k = 'o2')::text || '/item.jpg'),
  ('order-proofs', (select v from ids where k = 'o2')::text || '/receipt.jpg');
do $$ begin
  perform public.submit_proof((select v from ids where k = 'o1'), array[(select v from ids where k = 'o1')::text || '/item1.jpg'], array[]::text[]);
  raise exception 'SHOULD NOT REACH';
exception when invalid_parameter_value then raise notice 'T11 ok: receipt photo required';
end $$;
select public.submit_proof((select v from ids where k = 'o1'),
  array[(select v from ids where k = 'o1')::text || '/item1.jpg'], array[(select v from ids where k = 'o1')::text || '/receipt1.jpg']);
select public.submit_proof((select v from ids where k = 'o2'),
  array[(select v from ids where k = 'o2')::text || '/item.jpg'], array[(select v from ids where k = 'o2')::text || '/receipt.jpg']);

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
select 'T12 shopper sees proofs + notified' as test,
  (select count(*) from public.order_proofs where order_id = (select v from ids where k = 'o1')) = 2
  and (select count(*) from public.notifications where kind = 'proof_submitted') = 2 as ok;
do $$ begin
  perform public.review_proof((select v from ids where k = 'o1'), false, ' ');
  raise exception 'SHOULD NOT REACH';
exception when invalid_parameter_value then raise notice 'T13 ok: rejection needs a reason';
end $$;
select public.review_proof((select v from ids where k = 'o1'), false, 'Receipt is blurry');

select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
select 'T14 traveler told to resend' as test,
  (select proof_status from public.orders where id = (select v from ids where k = 'o1')) = 'rejected'
  and (select count(*) from public.notifications where kind = 'proof_rejected') = 1 as ok;
insert into storage.objects (bucket_id, name) values ('order-proofs', (select v from ids where k = 'o1')::text || '/receipt2.jpg');
select public.submit_proof((select v from ids where k = 'o1'),
  array[(select v from ids where k = 'o1')::text || '/item1.jpg'], array[(select v from ids where k = 'o1')::text || '/receipt2.jpg']);

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
select public.review_proof((select v from ids where k = 'o1'), true);
select public.review_proof((select v from ids where k = 'o2'), true);
select 'T15 approved → IN_TRANSIT, shopper holds the code' as test,
  (select status from public.orders where id = (select v from ids where k = 'o1')) = 'IN_TRANSIT'
  and (select code ~ '^[0-9]{6}$' from public.handover_otps where order_id = (select v from ids where k = 'o1'))
  and (select count(*) from public.hub_tokens) = 0 as ok;

-- ---------- OTP handover (3.2) ----------
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
select 'T16 traveler cannot read the code, but has the hub QR' as test,
  (select count(*) from public.handover_otps) = 0 and (select count(*) from public.hub_tokens) = 1 as ok;
select 'T17 wrong code counted' as test,
  public.confirm_handover((select v from ids where k = 'o1'), case when (select 1) = 1 then 'abcdef' end) = 'wrong_code' as ok;

reset role;
create temp table secret as select code from public.handover_otps where order_id = (select v from ids where k = 'o1');
grant select on secret to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
select 'T18 right code releases payment' as test,
  public.confirm_handover((select v from ids where k = 'o1'), (select code from secret)) = 'released' as ok;
select 'T19 order delivered in person, traveler paid without the fee' as test,
  (select status = 'DELIVERED' and delivered_via = 'in_person' from public.orders where id = (select v from ids where k = 'o1'))
  and (select amount from public.payouts where escrow_id = (select v from ids where k = 'e1')) = 220 as ok;
do $$ begin
  perform public.confirm_handover((select v from ids where k = 'o1'), '123456');
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T20 ok: code is single-use';
end $$;

-- ---------- Hub drop-off with QR (3.3) ----------
reset role;
create temp table qr as select token from public.hub_tokens where order_id = (select v from ids where k = 'o2');
grant select on qr to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-00000000000c', true);
do $$ begin
  perform * from public.hub_lookup((select token from qr));
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T21 ok: only hub staff can scan';
end $$;
reset role;
insert into public.hub_operators (hub_id, user_id) values ((select v from ids where k = 'hub'), 'c0000000-0000-0000-0000-00000000000c');
set role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-00000000000c', true);
select 'T22 hub staff see the parcel' as test, title = 'Kindle' and traveler_name = 'Rami H.' as ok from public.hub_lookup((select token from qr));
select 'T23 hub staff see orders heading to their hub' as test, count(*) = 1 as ok from public.orders;
select public.hub_confirm_dropoff((select token from qr)) is not null as dropped_off;
reset role;
select 'T24 released at hub, shopper told to pick up' as test,
  (select status = 'DELIVERED' and delivered_via = 'hub' and hub_dropoff_at is not null from public.orders where id = (select v from ids where k = 'o2'))
  and (select status from public.escrow_transactions where id = (select v from ids where k = 'e2')) = 'RELEASED'
  and (select count(*) from public.notifications where kind = 'hub_ready') = 1 as ok;
set role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-00000000000c', true);
do $$ begin
  perform public.hub_confirm_dropoff((select token from qr));
  raise exception 'SHOULD NOT REACH';
exception when no_data_found then raise notice 'T25 ok: QR is single-use';
end $$;

-- ---------- Locking + fee paid by traveler ----------
reset role;
update public.app_settings set fee_payer = 'traveler';
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
with x as (insert into public.orders (title, item_price, origin_country, reward_amount) values ('Lego', 50, 'AE', 5) returning id)
insert into ids select 'o3', id from x;
reset role;
update public.trips set capacity_kg = 10 where id = (select v from ids where k = 'trip');
set role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
insert into ids select 'of3', public.make_offer((select v from ids where k = 'o3'), (select v from ids where k = 'trip'), 5, 1);
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
select (public.respond_offer((select v from ids where k = 'of3'), 'accept')).status;
reset role;
set role service_role;
with x as (
  insert into public.escrow_transactions (order_id, shopper_id, traveler_id, item_amount, reward_amount)
  values ((select v from ids where k = 'o3'), 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b', 50, 5)
  returning id
) insert into ids select 'e3', id from x;
select 'T26 traveler-pays: shopper pays item + reward only' as test, total_amount = 55 and platform_fee = 1 as ok
  from public.escrow_transactions where id = (select v from ids where k = 'e3');
select (public.escrow_transition((select v from ids where k = 'e3'), 'HELD', 'whish')).status;
reset role;
update public.orders set status = 'IN_TRANSIT', proof_status = 'approved' where id = (select v from ids where k = 'o3');
select public.issue_handover_secret((select v from ids where k = 'o3'));
set role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
select public.confirm_handover((select v from ids where k = 'o3'), 'nope00') from generate_series(1, 4);
select 'T27 fifth wrong code locks' as test, public.confirm_handover((select v from ids where k = 'o3'), 'nope00') = 'locked' as ok;
select 'T28 still locked even with any code' as test, public.confirm_handover((select v from ids where k = 'o3'), '111111') = 'locked' as ok;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
select 'T29 shopper told it locked' as test, count(*) = 1 as ok from public.notifications where kind = 'handover_locked';
select public.regenerate_handover_code((select v from ids where k = 'o3'));
reset role;
create temp table secret3 as select code from public.handover_otps where order_id = (select v from ids where k = 'o3');
grant select on secret3 to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
select 'T30 new code works after regenerate' as test, public.confirm_handover((select v from ids where k = 'o3'), (select code from secret3)) = 'released' as ok;
select 'T31 traveler-pays: payout = item + reward − $1' as test, amount = 54 as ok
  from public.payouts where escrow_id = (select v from ids where k = 'e3');

select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-00000000000d', true);
select 'T32 stranger sees no proofs, codes or tokens' as test,
  (select count(*) from public.order_proofs) = 0 and (select count(*) from public.handover_otps) = 0
  and (select count(*) from public.hub_tokens) = 0 as ok;

rollback;
