-- =====================================================================
--  AUTH DATABASE SETUP  (Supabase / PostgreSQL)
--  Paste this whole file in: Supabase Dashboard > SQL Editor > New query > Run
--  Safe to run more than once.
-- =====================================================================
--  What Supabase Auth already gives you (no extra tables needed):
--    * auth.users       -> email, hashed password (bcrypt), confirmation state
--    * auth.identities  -> one row per login method (email, google)
--    * Same email via Google + Email/Password = ONE user (identities are linked)
--    * Password reset emails with secure, expiring, one-time links
--  This file adds a public "profiles" table that mirrors each user safely.
-- =====================================================================

-- 1) PROFILES TABLE ----------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text,
  full_name       text,
  avatar_url      text,
  providers       text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create index if not exists profiles_email_idx on public.profiles (lower(email));

-- 2) AUTO-UPDATE updated_at -------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 3) CREATE PROFILE WHEN A USER SIGNS UP (email OR google) -------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, providers, last_sign_in_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    coalesce(
      array(select jsonb_array_elements_text(new.raw_app_meta_data -> 'providers')),
      '{}'
    ),
    new.last_sign_in_at
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) KEEP PROFILE IN SYNC (email change, new login method linked, last login)
create or replace function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
     set email           = new.email,
         providers       = coalesce(
                             array(select jsonb_array_elements_text(new.raw_app_meta_data -> 'providers')),
                             p.providers
                           ),
         full_name       = coalesce(p.full_name,
                             new.raw_user_meta_data ->> 'full_name',
                             new.raw_user_meta_data ->> 'name'),
         avatar_url      = coalesce(p.avatar_url,
                             new.raw_user_meta_data ->> 'avatar_url',
                             new.raw_user_meta_data ->> 'picture'),
         last_sign_in_at = new.last_sign_in_at
   where p.id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function public.handle_user_updated();

-- 5) ROW LEVEL SECURITY: each user can only see / edit their OWN profile
alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile"   on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert/delete policies on purpose: rows are created by the trigger
-- and removed automatically when the auth user is deleted.

-- Only allow editing the safe columns from the browser
revoke update on public.profiles from authenticated;
grant  update (full_name, avatar_url) on public.profiles to authenticated;
grant  select on public.profiles to authenticated;

-- 6) BACKFILL profiles for users that already exist ---------------------
insert into public.profiles (id, email, full_name, avatar_url, providers, last_sign_in_at)
select u.id,
       u.email,
       coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
       coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
       coalesce(array(select jsonb_array_elements_text(u.raw_app_meta_data -> 'providers')), '{}'),
       u.last_sign_in_at
from auth.users u
on conflict (id) do nothing;

-- =====================================================================
-- DONE. Now follow README.md for: Site URL, Redirect URLs, Google login.
-- =====================================================================
