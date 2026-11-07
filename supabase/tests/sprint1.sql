-- Sprint 1 database tests: RLS, KYC flow, escrow state machine.
-- Runs inside a transaction and rolls back, so it leaves no data behind.
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/sprint1.sql
-- Every line should end in |t or print a NOTICE "ok". Any failure stops the run.
begin;
\set ON_ERROR_STOP on

-- Users: shopper (phone signup), traveler (google), admin
insert into auth.users (id, phone) values ('11111111-1111-1111-1111-111111111111', '96170123456');
insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-222222222222', 'trav@example.com', '{"full_name":"Rami Traveler","avatar_url":"https://x/y.png"}');
insert into auth.users (id, phone) values ('33333333-3333-3333-3333-333333333333', '+9613000000');
update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333';

select 'T1 profiles created' as test, count(*) = 3 as ok from public.profiles;
select 'T2 phone normalized' as test, phone = '+96170123456' as ok from public.profiles where id = '11111111-1111-1111-1111-111111111111';
select 'T3 google name copied' as test, full_name = 'Rami Traveler' and kyc_status = 'not_submitted' as ok from public.profiles where id = '22222222-2222-2222-2222-222222222222';

-- Act as shopper
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select 'T4 sees only own profile' as test, count(*) = 1 as ok from public.profiles;
update public.profiles set full_name = 'Maya Shopper', whish_phone = '+96170123456';
select 'T5 safe column update ok' as test, full_name = 'Maya Shopper' as ok from public.profiles;

do $$ begin
  update public.profiles set kyc_status = 'verified';
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T6 ok: cannot self-verify';
end $$;
do $$ begin
  update public.profiles set role = 'admin';
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T7 ok: cannot self-promote';
end $$;

-- Upload (simulated) and submit KYC
insert into storage.objects (bucket_id, name) values ('kyc-documents', '11111111-1111-1111-1111-111111111111/front.jpg');
insert into storage.objects (bucket_id, name) values ('kyc-documents', '11111111-1111-1111-1111-111111111111/back.jpg');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('kyc-documents', '22222222-2222-2222-2222-222222222222/evil.jpg');
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T8 ok: cannot upload into another user folder';
end $$;

do $$ begin
  perform public.submit_kyc('national_id', '11111111-1111-1111-1111-111111111111/front.jpg', null);
  raise exception 'SHOULD NOT REACH';
exception when invalid_parameter_value then raise notice 'T9 ok: ID needs back side';
end $$;

select 'T10 submit ok' as test, public.submit_kyc('national_id',
  '11111111-1111-1111-1111-111111111111/front.jpg', '11111111-1111-1111-1111-111111111111/back.jpg') is not null as ok;
select 'T11 badge pending' as test, kyc_status = 'pending' as ok from public.profiles;

do $$ begin
  perform public.submit_kyc('passport', '11111111-1111-1111-1111-111111111111/front.jpg', null);
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T12 ok: no double submission';
end $$;

do $$ begin
  perform public.review_kyc((select id from public.kyc_submissions limit 1), true, null);
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T13 ok: non-admin cannot review';
end $$;

-- Escrow is read-only for users
do $$ begin
  insert into public.escrow_transactions (shopper_id, traveler_id, item_amount, reward_amount)
  values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 10, 5);
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T14 ok: users cannot create escrow rows';
end $$;
do $$ begin
  perform public.escrow_transition(gen_random_uuid(), 'HELD', 'user');
  raise exception 'SHOULD NOT REACH';
exception when insufficient_privilege then raise notice 'T15 ok: users cannot call escrow_transition';
end $$;

-- Act as admin
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select 'T16 admin sees all profiles' as test, count(*) = 3 as ok from public.profiles;
select 'T17 admin sees kyc file' as test, count(*) = 2 as ok from storage.objects where bucket_id = 'kyc-documents';
do $$ begin
  perform public.review_kyc((select id from public.kyc_submissions limit 1), false, '  ');
  raise exception 'SHOULD NOT REACH';
exception when invalid_parameter_value then raise notice 'T18 ok: reject needs reason';
end $$;
select public.review_kyc((select id from public.kyc_submissions limit 1), true, null);
select 'T19 approved' as test, kyc_status = 'verified' and kyc_reviewed_at is not null as ok
  from public.profiles where id = '11111111-1111-1111-1111-111111111111';

-- Service role (Edge Functions) drives escrow
reset role;
set role service_role;
insert into public.escrow_transactions (id, shopper_id, traveler_id, item_amount, reward_amount, currency)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 120.50, 25, 'USD');
select 'T20 total + externalId' as test, total_amount = 145.50 and whish_external_id >= 100001 as ok
  from public.escrow_transactions;

do $$ begin
  perform public.escrow_transition('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RELEASED', 'admin');
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T21 ok: cannot release before HELD';
end $$;
do $$ begin
  update public.escrow_transactions set status = 'RELEASED' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T22 ok: trigger blocks direct illegal update';
end $$;

select (public.escrow_transition('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'HELD', 'whish', null, null, '{"payer_phone":"96170123456"}')).status;
select (public.escrow_transition('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'HELD', 'whish')).status as idempotent;
select 'T23 held' as test, status = 'HELD' and held_at is not null and payer_phone = '96170123456' as ok from public.escrow_transactions;
select 'T24 one event despite duplicate callback' as test, count(*) = 1 as ok from public.escrow_events;

do $$ begin
  update public.escrow_transactions set item_amount = 1 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T25 ok: amounts immutable';
end $$;

select (public.escrow_transition('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RELEASED', 'admin', '33333333-3333-3333-3333-333333333333', 'handover verified', '{"method":"admin"}')).status;
select 'T26 released + payout queued' as test,
  e.status = 'RELEASED' and e.release_method = 'admin' and p.amount = 145.50 and p.status = 'queued'
  as ok
  from public.escrow_transactions e join public.payouts p on p.escrow_id = e.id;
select (public.escrow_transition('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RELEASED', 'admin')).status as idempotent_release;
select 'T27 no duplicate payout' as test, count(*) = 1 as ok from public.payouts;

do $$ begin
  perform public.escrow_transition('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'REFUNDED', 'admin');
  raise exception 'SHOULD NOT REACH';
exception when raise_exception then raise notice 'T28 ok: RELEASED is terminal';
end $$;

-- Parties can read, strangers cannot
reset role;
insert into auth.users (id, phone) values ('44444444-4444-4444-4444-444444444444', '96171999999');
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'T29 traveler sees escrow + payout + events' as test,
  (select count(*) from public.escrow_transactions) = 1
  and (select count(*) from public.payouts) = 1
  and (select count(*) from public.escrow_events) = 2 as ok;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select 'T30 stranger sees nothing' as test,
  (select count(*) from public.escrow_transactions) = 0
  and (select count(*) from public.payouts) = 0
  and (select count(*) from public.kyc_submissions) = 0 as ok;

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select public.mark_payout_paid((select id from public.payouts limit 1), 'WH-TRX-778899');
select 'T31 payout marked paid' as test, status = 'paid' and provider_reference = 'WH-TRX-778899' as ok from public.payouts;

-- Contact sync
reset role;
update auth.users set phone = '96176555555' where id = '22222222-2222-2222-2222-222222222222';
select 'T32 phone sync' as test, phone = '+96176555555' as ok from public.profiles where id = '22222222-2222-2222-2222-222222222222';

rollback;
