-- =====================================================================
--  PROFILE PAGE SETUP  (Supabase / PostgreSQL)
--  Run AFTER schema.sql (and payments.sql):  SQL Editor > New query > paste > Run
--  Safe to run more than once.
-- =====================================================================
--  Adds: profile-photo storage bucket + security rules, name rules,
--        and a fix so a removed/changed photo or name is never overwritten
--        by Google on the next login.
-- =====================================================================

-- 1) NAME RULES: 2-80 characters (empty/NULL still allowed for old rows) ------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_full_name_length') then
    alter table public.profiles
      add constraint profiles_full_name_length
      check (full_name is null or char_length(btrim(full_name)) between 2 and 80) not valid;
  end if;
end $$;

-- 2) STOP AUTO-OVERWRITING name/photo on every login --------------------------
-- (name + photo are filled ONCE at sign-up; after that the user owns them.
--  Email, login methods and last sign-in still stay in sync.)
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
         last_sign_in_at = new.last_sign_in_at
   where p.id = new.id;
  return new;
end;
$$;

-- 3) AVATAR STORAGE BUCKET ----------------------------------------------------
-- Public bucket (photos are shown by URL), max 2 MB, images only.
-- Each user can only write inside their OWN folder:  avatars/<user-id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "avatars: read own folder"   on storage.objects;
drop policy if exists "avatars: upload own folder" on storage.objects;
drop policy if exists "avatars: update own folder" on storage.objects;
drop policy if exists "avatars: delete own folder" on storage.objects;

create policy "avatars: read own folder"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: upload own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: update own folder"
  on storage.objects for update to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: delete own folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Profiles: users may change ONLY name + photo (email, plan etc. stay locked)
revoke update on public.profiles from authenticated;
grant  update (full_name, avatar_url) on public.profiles to authenticated;

-- =====================================================================
-- DONE.
-- =====================================================================
