-- =====================================================================
--  PRO ACCESS CHECK  (Supabase / PostgreSQL)
--  Run AFTER schema.sql and payments.sql:  SQL Editor > New query > paste > Run
--  Safe to run more than once.
-- =====================================================================
--  Used by index.html every time a visitor taps a Pro feature:
--    my_entitlement()      -> is this logged-in user Pro right now? (SERVER time)
--    expire_subscriptions()-> flips finished plans to status = 'expired'
--  Pro is keyed to the account (auth.users), whose login email is the
--  one shown in profiles.email, so "this email has bought Pro" is exactly
--  "this account has an active, unexpired subscription".
-- =====================================================================

-- 1) Fast lookup of subscriptions by end date -----------------------------------
create index if not exists subscriptions_period_end_idx
  on public.subscriptions (current_period_end);

-- 2) my_entitlement(): one call that tells the website everything it needs ------
--    Uses the database clock (now()), not the visitor's device clock,
--    so changing the phone/PC date cannot extend Pro.
create or replace function public.my_entitlement()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then
      jsonb_build_object('logged_in', false, 'is_pro', false, 'plan', 'free')
    else coalesce(
      (select jsonb_build_object(
                'logged_in',          true,
                'is_pro',             (s.status = 'active' and s.current_period_end > now()),
                'plan',               case when s.status = 'active' and s.current_period_end > now()
                                           then s.plan_id else 'free' end,
                'status',             case when s.status = 'active' and s.current_period_end <= now()
                                           then 'expired' else s.status end,
                'current_period_end', s.current_period_end,
                'server_time',        now()
              )
         from public.subscriptions s
        where s.user_id = auth.uid()),
      jsonb_build_object('logged_in', true, 'is_pro', false, 'plan', 'free', 'server_time', now())
    )
  end;
$$;

revoke all on function public.my_entitlement() from public, anon;
grant execute on function public.my_entitlement() to authenticated;

-- 3) expire_subscriptions(): tidy-up so the table always tells the truth --------
--    (Access is already denied by the end-date check above; this only updates labels.)
create or replace function public.expire_subscriptions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.subscriptions
     set status = 'expired'
   where status = 'active' and current_period_end <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.expire_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_subscriptions() to service_role;

-- 4) OPTIONAL: run the tidy-up every hour with pg_cron ----------------------------
--    Supabase Dashboard > Database > Extensions > enable "pg_cron", then run:
--
--    select cron.schedule('expire-pro-subscriptions', '0 * * * *',
--                         $$ select public.expire_subscriptions(); $$);

-- =====================================================================
-- DONE.
-- =====================================================================
