-- Sign-in email quota: tracking and enforcement.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
-- WHY THIS EXISTS
--
-- Supabase's default SMTP limits *all* auth emails to a handful per hour, and
-- the docs are explicit that the limit is a "sum of combined requests
-- project-wide" and is "Custom SMTP Only" to customise. So the quota is shared
-- by the whole club, not per person: two members signing in back to back can
-- lock out the third, and the only thing the app showed for that was Supabase's
-- raw 429 text.
--
-- This records every request and refuses the ones that would exceed the quota,
-- so the failure happens here — with an honest "try again at 3:47" — instead of
-- being spent against Supabase and bouncing back as an error.
--
-- CHANGING THE LIMIT: edit AUTH_EMAIL_LIMIT_PER_HOUR in the function below, and
-- keep it equal to (or one below) what Authentication > Rate Limits shows in the
-- dashboard. It deliberately lives in the database rather than in an env var, so
-- a caller cannot pass a bigger limit and talk its way past the check.

create table if not exists auth_email_requests (
  id           uuid primary key default uuid_generate_v4(),
  email        text not null,
  -- 'pending' the moment it is claimed, 'sent' once the app confirms Supabase
  -- accepted it, 'failed' if it didn't. See the counting rule below.
  outcome      text not null default 'pending'
               check (outcome in ('pending', 'sent', 'failed')),
  -- Hashed and salted in the application, never the raw address. Null when
  -- AUTH_RATE_SALT isn't configured, which switches per-IP capping off.
  ip_hash      text,
  requested_at timestamptz not null default now()
);

create index if not exists auth_email_requests_recent_idx
  on auth_email_requests (requested_at desc);
create index if not exists auth_email_requests_ip_idx
  on auth_email_requests (ip_hash, requested_at desc) where ip_hash is not null;

alter table auth_email_requests enable row level security;

-- Deliberately NO policy for anon. The login page is unauthenticated and must
-- never be able to read this table directly — the rows are club members' email
-- addresses, and exposing them would turn the login page into a roster. All
-- unauthenticated access goes through the security-definer functions below,
-- which return counts and never addresses.
do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename='auth_email_requests' and policyname='auth_email_requests_admin_read') then
    create policy auth_email_requests_admin_read on auth_email_requests
      for select using (is_admin());
  end if;
end $$;

-- Supabase grants SELECT on new public tables to anon by default. RLS already
-- blocks every row (no policy matches anon), but anon has no business reading
-- this table at all and the security-definer functions below do not need the
-- grant. `authenticated` keeps it — RLS narrows that to admins.
--
-- Note this is NOT the same as revoking EXECUTE on is_member()/is_admin(),
-- which must keep their grants or every member query fails. See HANDOFF.md.
revoke all on public.auth_email_requests from anon;

-- ------------------------------------------------------------------ counting
--
-- A row counts against the quota if it was confirmed sent, OR if it is still
-- pending and very recent.
--
-- That second clause is the interesting one. `claim_auth_email` is callable by
-- anon — it has to be, the login page has no session — so someone could call it
-- directly in a loop and mark the club's quota exhausted without a single email
-- being sent, locking everyone out. Counting pending rows for only a minute
-- caps that attack at a minute, and it self-heals with no cleanup job. A real
-- sign-in confirms within a second, so the window never affects normal use.
create or replace function auth_email_used(window_start timestamptz)
returns int
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select count(*)::int
    from auth_email_requests
   where requested_at > window_start
     and (outcome = 'sent'
          or (outcome = 'pending' and requested_at > now() - interval '1 minute'));
$$;

revoke execute on function auth_email_used(timestamptz) from anon, authenticated, public;

-- ------------------------------------------------------------------- reading
-- Aggregate only: how many of the club's hourly allowance is gone, and when the
-- next one frees up. No addresses, so this is safe to hand an anonymous page.
create or replace function auth_email_quota()
returns table (used int, quota int, retry_after timestamptz)
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare
  limit_per_hour constant int := 2;   -- keep in step with the dashboard
  window_start timestamptz := now() - interval '1 hour';
begin
  return query
  select
    auth_email_used(window_start),
    limit_per_hour,
    (select min(requested_at) + interval '1 hour'
       from auth_email_requests
      where requested_at > window_start
        and (outcome = 'sent'
             or (outcome = 'pending' and requested_at > now() - interval '1 minute')));
end;
$$;

grant execute on function auth_email_quota() to anon, authenticated;

-- ------------------------------------------------------------------ claiming
-- Reserves one of the hour's emails, or refuses. Returns the same shape either
-- way so the caller can show the state without a second round trip.
create or replace function claim_auth_email(p_email text, p_ip_hash text default null)
returns table (allowed boolean, claim_id uuid, used int, quota int, retry_after timestamptz)
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  limit_per_hour constant int := 2;    -- the club's shared allowance
  ip_limit_per_hour constant int := 4; -- only applies when a hash is supplied
  -- A ceiling on how many rows one hour can create at all, so hammering the
  -- endpoint cannot grow the table without bound on a 500MB free tier.
  insert_ceiling constant int := 200;
  window_start timestamptz := now() - interval '1 hour';
  v_used int;
  v_retry timestamptz;
  v_ip_used int;
  v_rows_this_hour int;
  v_id uuid;
begin
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'A valid email address is required';
  end if;

  -- Housekeeping, cheap and inline: nothing older than a week is of any use and
  -- this keeps the table permanently small.
  delete from auth_email_requests where requested_at < now() - interval '7 days';

  select auth_email_used(window_start) into v_used;

  select min(requested_at) + interval '1 hour' into v_retry
    from auth_email_requests
   where requested_at > window_start
     and (outcome = 'sent'
          or (outcome = 'pending' and requested_at > now() - interval '1 minute'));

  select count(*) into v_rows_this_hour
    from auth_email_requests where requested_at > window_start;

  if p_ip_hash is not null then
    select count(*) into v_ip_used
      from auth_email_requests
     where ip_hash = p_ip_hash and requested_at > window_start;
  else
    v_ip_used := 0;
  end if;

  if v_used >= limit_per_hour
     or v_ip_used >= ip_limit_per_hour
     or v_rows_this_hour >= insert_ceiling then
    -- Record the refusal, but as 'failed' so it never counts against the quota
    -- itself — otherwise a burst of blocked attempts would extend the lockout.
    if v_rows_this_hour < insert_ceiling then
      insert into auth_email_requests (email, outcome, ip_hash)
      values (lower(p_email), 'failed', p_ip_hash);
    end if;

    return query select false, null::uuid, v_used, limit_per_hour, v_retry;
    return;
  end if;

  insert into auth_email_requests (email, outcome, ip_hash)
  values (lower(p_email), 'pending', p_ip_hash)
  returning id into v_id;

  return query select true, v_id, v_used + 1, limit_per_hour,
                      coalesce(v_retry, now() + interval '1 hour');
end;
$$;

grant execute on function claim_auth_email(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- confirming
-- Settles a claim once the app knows whether Supabase accepted it. A claim that
-- failed is released rather than charged, so a typo or a network error doesn't
-- cost the club one of its two.
create or replace function settle_auth_email(p_claim_id uuid, p_sent boolean)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  update auth_email_requests
     set outcome = case when p_sent then 'sent' else 'failed' end
   where id = p_claim_id
     and outcome = 'pending';
end;
$$;

grant execute on function settle_auth_email(uuid, boolean) to anon, authenticated;
