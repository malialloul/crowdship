-- Payout breakdown tests (migration 20261107000005). Rolls back.
-- Every line should end in |t or print a NOTICE "ok".
begin;
\set ON_ERROR_STOP on

insert into auth.users (id, phone) values ('11111111-1111-1111-1111-111111111111', '96170123456');
insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-222222222222', 'trav@example.com', '{"full_name":"Rami Haddad"}');
insert into auth.users (id, phone) values ('33333333-3333-3333-3333-333333333333', '+9613000000');
update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set whish_phone = '+96171123456' where id = '22222222-2222-2222-2222-222222222222';

select 'B1 money text' as test,
  public.money_text(1234.5, 'USD') = '$1,234.50'
  and public.money_text(0, 'USD') = '$0.00'
  and public.money_text(90000, 'LBP') = '90,000 LBP' as ok;

-- Shopper pays the $1 app commission (default)
insert into public.orders (id, shopper_id, title, item_price, weight_kg, origin_country, reward_amount)
values ('0a000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'AirPods Pro 2', 229, 0.5, 'AE', 20);

set role service_role;
insert into public.escrow_transactions (id, order_id, shopper_id, traveler_id, item_amount, reward_amount, currency)
values ('e0000000-0000-0000-0000-000000000001', '0a000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 229, 20, 'USD');
select (public.escrow_transition('e0000000-0000-0000-0000-000000000001', 'HELD', 'whish')).status;
reset role;

select 'B2 held: traveler told their cut' as test,
  body = '"AirPods Pro 2": you get $249.00 on delivery (item $229.00 + commission $20.00).' as ok
  from public.notifications where kind = 'payment_held';

set role service_role;
select (public.escrow_transition('e0000000-0000-0000-0000-000000000001', 'RELEASED', 'admin')).status;
reset role;

select 'B3 released: traveler breakdown' as test,
  body = '$249.00 for "AirPods Pro 2" is on its way to your Whish (item $229.00 + commission $20.00).' as ok
  from public.notifications where kind = 'payment_released';
select 'B4 admin told exactly what to send' as test,
  user_id = '33333333-3333-3333-3333-333333333333'
  and title = 'Send $249.00 to Rami Haddad on Whish'
  and body = '"AirPods Pro 2": item $229.00 + traveler commission $20.00. App commission $1.00 (paid by the shopper). Whish number: +96171123456.'
  and link = '/admin/escrow' as ok
  from public.notifications where kind = 'payout_queued';
select 'B5 payout amount matches' as test, amount = 249 as ok from public.payouts;

-- Admin marks it sent without a reference
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  perform public.mark_payout_paid((select id from public.payouts limit 1));
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'B6 ok: traveler cannot mark paid';
end $$;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select public.mark_payout_paid((select id from public.payouts limit 1));
select 'B7 paid without reference' as test, status = 'paid' and provider_reference is null and paid_at is not null as ok from public.payouts;
do $$ begin
  perform public.mark_payout_paid((select id from public.payouts limit 1), 'X');
  raise exception 'SHOULD NOT REACH';
exception when no_data_found then raise notice 'B8 ok: cannot pay twice';
end $$;
reset role;
select 'B9 traveler told it was sent' as test,
  user_id = '22222222-2222-2222-2222-222222222222'
  and body = '$249.00 for "AirPods Pro 2" was sent to your Whish account.' as ok
  from public.notifications where kind = 'payout_sent';

-- Traveler pays the commission instead, with a reference
update public.app_settings set fee_payer = 'traveler';
insert into public.orders (id, shopper_id, title, item_price, weight_kg, origin_country, reward_amount)
values ('0a000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Kindle Paperwhite', 150, 0.3, 'AE', 15);
set role service_role;
insert into public.escrow_transactions (id, order_id, shopper_id, traveler_id, item_amount, reward_amount, currency)
values ('e0000000-0000-0000-0000-000000000002', '0a000000-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 150, 15, 'USD');
select (public.escrow_transition('e0000000-0000-0000-0000-000000000002', 'HELD', 'whish')).status;
select (public.escrow_transition('e0000000-0000-0000-0000-000000000002', 'RELEASED', 'admin')).status;
reset role;
select 'B10 traveler-paid commission deducted' as test,
  (select amount from public.payouts p where p.escrow_id = 'e0000000-0000-0000-0000-000000000002') = 164
  and (select body from public.notifications where kind = 'payment_released' order by created_at desc, id limit 1) is not null
  and exists (select 1 from public.notifications where kind = 'payment_released'
              and body = '$164.00 for "Kindle Paperwhite" is on its way to your Whish (item $150.00 + commission $15.00 − app commission $1.00).')
  and exists (select 1 from public.notifications where kind = 'payout_queued'
              and body like '%App commission $1.00 (taken from the traveler)%') as ok;

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select public.mark_payout_paid((select id from public.payouts where escrow_id = 'e0000000-0000-0000-0000-000000000002'), '  WH-55 ');
reset role;
select 'B11 reference trimmed + shown to traveler' as test,
  exists (select 1 from public.payouts where provider_reference = 'WH-55')
  and exists (select 1 from public.notifications where kind = 'payout_sent'
              and body = '$164.00 for "Kindle Paperwhite" was sent to your Whish account (ref WH-55).') as ok;

-- LBP formatting
select 'B12 LBP money text' as test, public.money_text(4500000, 'LBP') = '4,500,000 LBP' as ok;

rollback;
