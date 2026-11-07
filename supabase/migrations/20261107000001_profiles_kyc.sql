-- =============================================================================
-- Sprint 1 · Story 1.1 — Profiles, KYC submissions, storage buckets
-- =============================================================================

-- ---------- Enums ------------------------------------------------------------
create type public.user_role as enum ('user', 'admin');

-- not_submitted → pending → verified | rejected (rejected can resubmit → pending)
create type public.kyc_status as enum ('not_submitted', 'pending', 'verified', 'rejected');

create type public.kyc_document_type as enum ('national_id', 'passport');

-- ---------- Helpers ----------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- Profiles ---------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  full_name            text check (char_length(full_name) <= 120),
  phone                text,            -- E.164, synced from auth.users
  email                text,            -- synced from auth.users
  avatar_url           text,
  whish_phone          text check (whish_phone is null or whish_phone ~ '^\+[1-9][0-9]{7,14}$'),
  role                 public.user_role  not null default 'user',
  kyc_status           public.kyc_status not null default 'not_submitted',
  kyc_reviewed_at      timestamptz,
  kyc_rejection_reason text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Admin check used by RLS. SECURITY DEFINER so it can read profiles without
-- recursing into the profiles RLS policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Create a profile row for every new auth user (phone OTP or Google).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, phone, email, full_name, avatar_url)
  values (
    new.id,
    case
      when coalesce(new.phone, '') = '' then null
      when new.phone like '+%' then new.phone
      else '+' || new.phone
    end,
    nullif(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep phone/email in sync if the user later links or changes them.
create or replace function public.handle_user_contact_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set phone = case
                when coalesce(new.phone, '') = '' then null
                when new.phone like '+%' then new.phone
                else '+' || new.phone
              end,
      email = nullif(new.email, '')
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_contact_updated
  after update of phone, email on auth.users
  for each row
  when (old.phone is distinct from new.phone or old.email is distinct from new.email)
  execute function public.handle_user_contact_update();

-- Create profiles for anyone who signed up before this script ran.
insert into public.profiles (id, phone, email, full_name, avatar_url)
select
  u.id,
  case
    when coalesce(u.phone, '') = '' then null
    when u.phone like '+%' then u.phone
    else '+' || u.phone
  end,
  nullif(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
  u.raw_user_meta_data ->> 'avatar_url'
from auth.users u
on conflict (id) do nothing;

-- ---------- KYC submissions --------------------------------------------------
create table public.kyc_submissions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  document_type       public.kyc_document_type not null,
  document_path       text not null,          -- front / passport photo page
  document_back_path  text,                   -- required for national_id
  status              public.kyc_status not null default 'pending'
                        check (status in ('pending', 'verified', 'rejected')),
  reviewer_id         uuid references public.profiles (id) on delete set null,
  reviewed_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz not null default now(),
  constraint kyc_back_required_for_id
    check (document_type <> 'national_id' or document_back_path is not null)
);

create index kyc_submissions_user_idx on public.kyc_submissions (user_id, created_at desc);
create index kyc_submissions_status_idx on public.kyc_submissions (status, created_at);
-- At most one open submission per user.
create unique index kyc_one_pending_per_user
  on public.kyc_submissions (user_id) where status = 'pending';

-- Submit documents (already uploaded to the kyc-documents bucket).
create or replace function public.submit_kyc(
  p_document_type      public.kyc_document_type,
  p_document_path      text,
  p_document_back_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_status public.kyc_status;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select kyc_status into v_status from public.profiles where id = v_uid for update;
  if v_status is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if v_status = 'pending' then
    raise exception 'a submission is already under review' using errcode = 'P0001';
  end if;
  if v_status = 'verified' then
    raise exception 'identity already verified' using errcode = 'P0001';
  end if;

  if p_document_type = 'national_id' and p_document_back_path is null then
    raise exception 'national ID requires front and back images' using errcode = '22023';
  end if;

  -- Files must live in the caller's own folder and actually exist.
  if split_part(p_document_path, '/', 1) <> v_uid::text
     or (p_document_back_path is not null and split_part(p_document_back_path, '/', 1) <> v_uid::text) then
    raise exception 'documents must be uploaded to your own folder' using errcode = '42501';
  end if;

  if not exists (select 1 from storage.objects where bucket_id = 'kyc-documents' and name = p_document_path)
     or (p_document_back_path is not null and not exists (
           select 1 from storage.objects where bucket_id = 'kyc-documents' and name = p_document_back_path)) then
    raise exception 'uploaded document not found' using errcode = 'P0002';
  end if;

  insert into public.kyc_submissions (user_id, document_type, document_path, document_back_path)
  values (v_uid, p_document_type, p_document_path, p_document_back_path)
  returning id into v_id;

  update public.profiles
  set kyc_status = 'pending', kyc_rejection_reason = null, kyc_reviewed_at = null
  where id = v_uid;

  return v_id;
end;
$$;

-- Admin approves or rejects a pending submission.
create or replace function public.review_kyc(
  p_submission_id uuid,
  p_approve       boolean,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.kyc_submissions;
  v_new public.kyc_status := case when p_approve then 'verified' else 'rejected' end;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;

  if not p_approve and coalesce(btrim(p_reason), '') = '' then
    raise exception 'a rejection reason is required' using errcode = '22023';
  end if;

  select * into v_sub from public.kyc_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'submission not found' using errcode = 'P0002';
  end if;
  if v_sub.status <> 'pending' then
    raise exception 'submission already reviewed' using errcode = 'P0001';
  end if;

  update public.kyc_submissions
  set status = v_new,
      reviewer_id = auth.uid(),
      reviewed_at = now(),
      rejection_reason = case when p_approve then null else btrim(p_reason) end
  where id = p_submission_id;

  update public.profiles
  set kyc_status = v_new,
      kyc_reviewed_at = now(),
      kyc_rejection_reason = case when p_approve then null else btrim(p_reason) end
  where id = v_sub.user_id;
end;
$$;

-- ---------- Privileges & RLS -------------------------------------------------
alter table public.profiles enable row level security;
alter table public.kyc_submissions enable row level security;

-- Users may only edit safe columns. role / kyc_* change only via the
-- SECURITY DEFINER functions above (or service_role).
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, whish_phone) on public.profiles to authenticated;

revoke insert, update, delete on public.kyc_submissions from anon, authenticated;

create policy "profiles: read own or admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "kyc: read own or admin"
  on public.kyc_submissions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

revoke execute on function public.submit_kyc(public.kyc_document_type, text, text) from public, anon;
revoke execute on function public.review_kyc(uuid, boolean, text) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_contact_update() from public, anon, authenticated;
grant execute on function public.submit_kyc(public.kyc_document_type, text, text) to authenticated;
grant execute on function public.review_kyc(uuid, boolean, text) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- Storage ----------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880,
     array['image/jpeg', 'image/png', 'image/webp']),
  ('kyc-documents', 'kyc-documents', false, 10485760,
     array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- avatars/{user_id}/avatar.{ext} — public read via public URL, owner writes.
create policy "avatars: owner select"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: owner insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: owner update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- kyc-documents/{user_id}/... — private. Owner can upload & read; admins read.
-- No update/delete: submitted evidence is immutable.
create policy "kyc docs: owner insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "kyc docs: owner or admin select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'kyc-documents'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin())
  );
