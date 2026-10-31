-- =====================================================================
--  PAYMENTS DATABASE SETUP  (Supabase / PostgreSQL)
--  Run AFTER schema.sql:  SQL Editor > New query > paste > Run
--  Safe to run more than once.
-- =====================================================================
--  Tables
--    plans          public price list (read by the pricing page)
--    payments       one row per checkout attempt (written ONLY by the server)
--    subscriptions  one row per user: which plan, active until when
--  Security: browsers can only READ their own rows. Money-related writes
--  happen only inside Edge Functions using the service_role key, after the
--  Razorpay signature is verified.
-- =====================================================================

-- 1) PLANS -------------------------------------------------------------
-- Amounts are in the SMALLEST unit: USD in cents (500 = $5.00), INR in paise (44900 = Rs 449).
create table if not exists public.plans (
  id               text primary key,                 -- 'pro_monthly' | 'pro_yearly'
  name             text not null,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  amount_usd       integer not null check (amount_usd >= 0),
  amount_inr       integer not null check (amount_inr >= 0),
  active           boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);

-- Yearly = $48 (20% cheaper than 12 x $5 = $60).
-- INR: Rs 449 / month and Rs 4,310 / year (also exactly 20% off 12 x 449 = 5,388).
-- Change these numbers any time to follow the exchange rate; the app reads them live.
insert into public.plans (id, name, billing_interval, amount_usd, amount_inr, sort_order) values
  ('pro_monthly', 'Pro Monthly', 'month',  500,  44900, 1),
  ('pro_yearly',  'Pro Yearly',  'year',  4800, 431000, 2)
on conflict (id) do update
  set name = excluded.name,
      billing_interval = excluded.billing_interval,
      amount_usd = excluded.amount_usd,
      amount_inr = excluded.amount_inr,
      sort_order = excluded.sort_order;

-- 2) PAYMENTS ----------------------------------------------------------
create table if not exists public.payments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  plan_id              text not null references public.plans (id),
  provider             text not null default 'razorpay',
  provider_order_id    text not null unique,
  provider_payment_id  text unique,
  amount               integer not null,
  currency             text not null check (currency in ('INR', 'USD')),
  status               text not null default 'created'
                         check (status in ('created', 'paid', 'failed', 'refunded')),
  method               text,
  failure_reason       text,
  created_at           timestamptz not null default now(),
  paid_at              timestamptz,
  updated_at           timestamptz not null default now()
);

create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- 3) SUBSCRIPTIONS -----------------------------------------------------
create table if not exists public.subscriptions (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  plan_id             text not null references public.plans (id),
  status              text not null default 'active' check (status in ('active', 'canceled', 'expired')),
  current_period_end  timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- 4) ROW LEVEL SECURITY ------------------------------------------------
alter table public.plans         enable row level security;
alter table public.payments      enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Anyone can read active plans"        on public.plans;
drop policy if exists "Users can read own payments"         on public.payments;
drop policy if exists "Users can read own subscription"     on public.subscriptions;

create policy "Anyone can read active plans"
  on public.plans for select to anon, authenticated using (active = true);

create policy "Users can read own payments"
  on public.payments for select to authenticated using (auth.uid() = user_id);

create policy "Users can read own subscription"
  on public.subscriptions for select to authenticated using (auth.uid() = user_id);

-- Browsers get read-only access. No insert/update/delete policies exist at all.
revoke all on public.plans, public.payments, public.subscriptions from anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.payments, public.subscriptions to authenticated;

-- 5) ACTIVATE A SUBSCRIPTION (called ONLY by Edge Functions, idempotent) -
-- Safe to call many times for the same payment (browser callback + webhook).
create or replace function public.activate_subscription(p_order_id text, p_payment_id text, p_method text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay   public.payments%rowtype;
  v_plan  public.plans%rowtype;
  v_start timestamptz;
  v_end   timestamptz;
begin
  select * into v_pay from public.payments where provider_order_id = p_order_id for update;
  if not found then
    raise exception 'order not found: %', p_order_id;
  end if;

  -- Already processed -> do nothing (idempotent)
  if v_pay.status = 'paid' then
    select current_period_end into v_end from public.subscriptions where user_id = v_pay.user_id;
    return jsonb_build_object('already_processed', true, 'current_period_end', v_end);
  end if;

  select * into v_plan from public.plans where id = v_pay.plan_id;

  update public.payments
     set status = 'paid', provider_payment_id = p_payment_id, method = coalesce(p_method, method),
         paid_at = now(), failure_reason = null
   where id = v_pay.id;

  -- Extend from the current end date if still active, otherwise from now
  select greatest(coalesce(max(current_period_end), now()), now()) into v_start
    from public.subscriptions where user_id = v_pay.user_id and status = 'active';
  v_start := coalesce(v_start, now());

  v_end := case v_plan.billing_interval
             when 'year' then v_start + interval '1 year'
             else v_start + interval '1 month'
           end;

  insert into public.subscriptions (user_id, plan_id, status, current_period_end)
  values (v_pay.user_id, v_pay.plan_id, 'active', v_end)
  on conflict (user_id) do update
    set plan_id = excluded.plan_id, status = 'active', current_period_end = excluded.current_period_end;

  return jsonb_build_object('already_processed', false, 'current_period_end', v_end);
end;
$$;

-- 6) MARK FAILED / REFUNDED (called ONLY by Edge Functions) --------------
create or replace function public.mark_payment_failed(p_order_id text, p_payment_id text, p_reason text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payments
     set status = 'failed', provider_payment_id = coalesce(provider_payment_id, p_payment_id), failure_reason = p_reason
   where provider_order_id = p_order_id and status = 'created';
$$;

create or replace function public.mark_payment_refunded(p_payment_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
begin
  select * into v_pay from public.payments where provider_payment_id = p_payment_id for update;
  if not found or v_pay.status = 'refunded' then
    return;
  end if;

  update public.payments set status = 'refunded' where id = v_pay.id;

  -- A fully refunded latest payment ends Pro access immediately
  update public.subscriptions
     set status = 'canceled', current_period_end = least(current_period_end, now())
   where user_id = v_pay.user_id
     and not exists (
       select 1 from public.payments p
        where p.user_id = v_pay.user_id and p.status = 'paid' and p.paid_at > v_pay.paid_at
     );
end;
$$;

-- Only the server (service_role) may run the three functions above
revoke all on function public.activate_subscription(text, text, text) from public, anon, authenticated;
revoke all on function public.mark_payment_failed(text, text, text)   from public, anon, authenticated;
revoke all on function public.mark_payment_refunded(text)             from public, anon, authenticated;
grant execute on function public.activate_subscription(text, text, text) to service_role;
grant execute on function public.mark_payment_failed(text, text, text)   to service_role;
grant execute on function public.mark_payment_refunded(text)             to service_role;

-- 7) HANDY: is the current user Pro?  select public.is_pro();  (use in RLS or queries)
create or replace function public.is_pro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions
     where user_id = auth.uid() and status = 'active' and current_period_end > now()
  );
$$;
grant execute on function public.is_pro() to authenticated;

-- =====================================================================
-- DONE. Next: deploy the 3 Edge Functions (see README.md, "Payments").
-- =====================================================================
