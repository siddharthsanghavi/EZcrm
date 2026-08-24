-- EZcrm schema. Run this once in the Supabase SQL editor.
-- Security model: an email must be in `allowed_emails` before a profile is created
-- for it. Every table's RLS policy requires a profile row, so a stranger who signs
-- up sees an empty database rather than your data.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------- access control

create table allowed_emails (
  email      text primary key,
  note       text,
  added_at   timestamptz not null default now()
);

create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text not null unique,
  full_name  text,
  role       text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

-- Fires when someone completes a magic-link signup. Only mints a profile if their
-- address was pre-approved, so the allowlist is the single gate into the app.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from allowed_emails where lower(email) = lower(new.email)) then
    insert into profiles (id, email, full_name)
    values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Used by every policy below. security definer so it can read profiles without
-- recursing into profiles' own RLS policy.
create or replace function is_member()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;

create or replace function is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------- crm tables

create table companies (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  website     text,
  industry    text,
  -- Outreach stage. Your club's pipeline lives here rather than in a separate
  -- deals table, so a company is the unit you track from cold to closed.
  status      text not null default 'prospect'
              check (status in ('prospect', 'contacted', 'in_conversation',
                                'committed', 'declined', 'dormant')),
  -- What you want from them; a company can be both.
  interest    text[] not null default '{}',   -- 'tour', 'sponsorship'
  notes       text,

  -- Directory fields, populated from an imported prospect list. These are what
  -- you filter by when picking who to call this week.
  type        text,          -- OEM, Integrator, Large Manufacturer, Machine Shop…
  tier        text,          -- Tier 1..3, or Reference. Tier 1 = call first.
  -- Sorting on `tier` alphabetically would put "Reference" above "Tier 1",
  -- which is exactly backwards. Rank it explicitly instead.
  tier_rank   integer generated always as (
                case tier
                  when 'Tier 1' then 1
                  when 'Tier 2' then 2
                  when 'Tier 3' then 3
                  when 'Reference' then 4
                  else 5
                end) stored,
  city        text,
  region      text,
  address     text,
  phone       text,
  employees   integer,
  owner_id    uuid references profiles on delete set null,
  created_by  uuid references profiles on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table contacts (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid references companies on delete cascade,
  first_name  text not null,
  last_name   text,
  email       text,
  phone       text,
  title       text,
  notes       text,
  owner_id    uuid references profiles on delete set null,
  created_by  uuid references profiles on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table activities (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid references companies on delete cascade,
  contact_id  uuid references contacts on delete set null,
  type        text not null default 'note'
              check (type in ('note', 'email', 'call', 'meeting', 'linkedin', 'other')),
  subject     text,
  body        text,
  occurred_at timestamptz not null default now(),
  created_by  uuid references profiles on delete set null,
  created_at  timestamptz not null default now()
);

create table tasks (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  details     text,
  due_date    date,
  done        boolean not null default false,
  done_at     timestamptz,
  company_id  uuid references companies on delete cascade,
  contact_id  uuid references contacts on delete set null,
  assignee_id uuid references profiles on delete set null,
  created_by  uuid references profiles on delete set null,
  created_at  timestamptz not null default now()
);

create index on contacts (company_id);
create index on activities (company_id, occurred_at desc);
create index on activities (contact_id);
create index on tasks (assignee_id, done, due_date);
create index on companies (status);
create index on companies (tier_rank, name);
create index on companies (type);
create index on companies (region);

-- Free-text search across the fields you'd actually search by.
create index companies_search on companies
  using gin (to_tsvector('english',
    name || ' ' || coalesce(industry, '') || ' ' || coalesce(notes, '') || ' '
         || coalesce(city, '') || ' ' || coalesce(type, '')));
create index contacts_search on contacts
  using gin (to_tsvector('english', first_name || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, '')));

create or replace function touch_updated_at()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_touch before update on companies
  for each row execute function touch_updated_at();
create trigger contacts_touch before update on contacts
  for each row execute function touch_updated_at();

-- Every function in `public` is also published as a REST endpoint
-- (/rest/v1/rpc/<name>). These two are only ever fired by triggers, so nothing
-- should be able to reach them directly.
revoke execute on function handle_new_user()  from anon, authenticated, public;
revoke execute on function touch_updated_at() from anon, authenticated, public;

-- is_member() and is_admin() must KEEP their EXECUTE grant. Policy evaluation
-- runs as the querying role, so revoking it makes every member query fail with
-- "permission denied for function is_member" rather than returning their rows.
grant execute on function is_member() to anon, authenticated;
grant execute on function is_admin()  to anon, authenticated;

-- ---------------------------------------------------------------- rls

alter table allowed_emails enable row level security;
alter table profiles       enable row level security;
alter table companies      enable row level security;
alter table contacts       enable row level security;
alter table activities     enable row level security;
alter table tasks          enable row level security;

-- Only admins manage the allowlist, and only from inside the app.
create policy allowed_emails_admin on allowed_emails
  for all using (is_admin()) with check (is_admin());

create policy profiles_read on profiles
  for select using (is_member());
create policy profiles_self_update on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- The club shares one workspace: any member reads and writes any record. Deletes
-- are narrower, since that's the operation you can't undo from the UI.
do $$
declare t text;
begin
  foreach t in array array['companies', 'contacts', 'activities', 'tasks'] loop
    execute format('create policy %1$s_read on %1$s for select using (is_member())', t);
    execute format('create policy %1$s_insert on %1$s for insert with check (is_member())', t);
    execute format('create policy %1$s_update on %1$s for update using (is_member()) with check (is_member())', t);
    execute format(
      'create policy %1$s_delete on %1$s for delete using (is_admin() or created_by = auth.uid())', t);
  end loop;
end;
$$;

-- ------------------------------------------------- status history + assignment

create table if not exists status_events (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references companies on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references profiles on delete set null,
  -- clock_timestamp(), not now(): now() is the transaction start time, so two
  -- status changes in one transaction would share a timestamp and the history
  -- would sort arbitrarily.
  changed_at  timestamptz not null default clock_timestamp()
);

create index if not exists status_events_company_idx on status_events (company_id, changed_at desc);
create index if not exists status_events_recent_idx  on status_events (changed_at desc);

alter table status_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='status_events' and policyname='status_events_read') then
    create policy status_events_read on status_events for select using (is_member());
  end if;
  if not exists (select 1 from pg_policies where tablename='status_events' and policyname='status_events_insert') then
    create policy status_events_insert on status_events for insert with check (is_member());
  end if;
end $$;

-- Recorded by trigger, not application code, so a change is logged wherever it
-- comes from — the UI, a bulk SQL update, anywhere.
create or replace function log_status_change()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    insert into status_events (company_id, from_status, to_status, changed_by, changed_at)
    values (new.id, old.status, new.status, auth.uid(), clock_timestamp());
  end if;
  return new;
end;
$$;

revoke execute on function log_status_change() from anon, authenticated, public;

drop trigger if exists companies_status_change on companies;
create trigger companies_status_change
  after update of status on companies
  for each row execute function log_status_change();

create index if not exists companies_owner_idx on companies (owner_id);
create index if not exists tasks_assignee_idx  on tasks (assignee_id, done);

-- ------------------------------------------------- role change safety
-- RLS has no per-column granularity, so profiles_self_update would otherwise
-- let a member set their own role to admin. Column privileges + a checked
-- function close that.
revoke update on public.profiles from authenticated;
grant  update (full_name) on public.profiles to authenticated;

create or replace function set_member_role(target uuid, new_role text)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare admins int;
begin
  if not is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  if new_role not in ('member', 'admin') then
    raise exception 'Invalid role';
  end if;

  -- Never leave the club without an admin.
  if new_role = 'member' then
    select count(*) into admins from profiles where role = 'admin';
    if admins <= 1 and (select role from profiles where id = target) = 'admin' then
      raise exception 'Cannot remove the last admin';
    end if;
  end if;

  update profiles set role = new_role where id = target;
end;
$$;

grant execute on function set_member_role(uuid, text) to authenticated;

-- ------------------------------------------------------------- last touch
-- `updated_at` is the wrong signal for "has anyone talked to them lately" --
-- fixing a typo in the notes bumps it, and so does a bulk status change. Track
-- real contact separately, on both the company and the person, so a
-- going-cold list means what it says.

alter table companies add column if not exists last_touch_at timestamptz;
alter table contacts  add column if not exists last_touch_at timestamptz;

-- nulls first: never-touched is the coldest thing there is, and the index
-- should hand those back at the front of the list rather than the end.
create index if not exists companies_last_touch_idx on companies (last_touch_at nulls first);
create index if not exists contacts_last_touch_idx  on contacts  (last_touch_at nulls first);

-- By trigger rather than application code, so an activity logged from anywhere
-- counts as a touch. The where clause stops a back-dated call from pulling a
-- company's last touch backwards.
create or replace function touch_last_contact()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.company_id is not null then
    update companies
       set last_touch_at = new.occurred_at
     where id = new.company_id
       and coalesce(last_touch_at, '-infinity'::timestamptz) < new.occurred_at;
  end if;

  if new.contact_id is not null then
    update contacts
       set last_touch_at = new.occurred_at
     where id = new.contact_id
       and coalesce(last_touch_at, '-infinity'::timestamptz) < new.occurred_at;
  end if;

  return new;
end;
$$;

revoke execute on function touch_last_contact() from anon, authenticated, public;

drop trigger if exists activities_touch_contact on activities;
create trigger activities_touch_contact
  after insert or update of occurred_at on activities
  for each row execute function touch_last_contact();

-- ------------------------------------------------------------ saved views
-- A filter combination someone worked out is worth keeping. Stored as the
-- querystring, so a view needs no schema of its own and stays a plain link.

create table if not exists saved_views (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  path       text not null default '/companies',
  query      text not null default '',
  shared     boolean not null default true,
  owner_id   uuid references profiles on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists saved_views_owner_idx on saved_views (owner_id);

alter table saved_views enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='saved_views' and policyname='saved_views_read') then
    create policy saved_views_read on saved_views
      for select using (is_member() and (shared or owner_id = auth.uid()));
  end if;
  -- owner_id must be the caller, or a member could file a view under someone
  -- else's name and lock the real author out of their own row.
  if not exists (select 1 from pg_policies where tablename='saved_views' and policyname='saved_views_insert') then
    create policy saved_views_insert on saved_views
      for insert with check (is_member() and owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='saved_views' and policyname='saved_views_update') then
    create policy saved_views_update on saved_views
      for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='saved_views' and policyname='saved_views_delete') then
    create policy saved_views_delete on saved_views
      for delete using (is_admin() or owner_id = auth.uid());
  end if;
end $$;

-- --------------------------------------------------- sign-in email quota
-- Supabase's default SMTP limits auth emails project-wide, not per user, and
-- the limit cannot be raised without custom SMTP. This tracks every request
-- and refuses the ones that would exceed it, so the failure is explained here
-- rather than spent at Supabase and returned as a 429.
-- See supabase/migrations/009_auth_email_quota.sql for the full reasoning.

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

-- -------------------------------------------------------- login tracking
-- Supabase's own auth audit log is pruned (empty on a real project), and
-- auth.users / auth.sessions aren't readable without a service-role key --
-- which this app deliberately doesn't have. So it records its own.
-- Counts sessions STARTED, where auth_email_requests counts links ASKED for;
-- the gap between the two is the number worth looking at.

create table if not exists login_events (
  id         uuid primary key default uuid_generate_v4(),
  profile_id uuid references profiles on delete set null,
  email      text,
  -- signed_in: a session was created and the user is a club member.
  -- denied:    authenticated fine, but no profile -- i.e. not on the allowlist.
  --            This is the allowlist doing its job, and worth seeing.
  -- failed:    the link itself didn't work. Usually the PKCE verifier is missing
  --            because the link was opened somewhere else.
  -- signed_out: explicit sign-out.
  event      text not null check (event in ('signed_in', 'denied', 'failed', 'signed_out')),
  -- Which flow was used, so you can tell whether moving the email template to
  -- /auth/confirm actually reduced the failures.
  method     text check (method in ('pkce', 'token_hash', 'implicit', 'oauth', 'unknown')),
  reason     text,
  ip_hash    text,
  created_at timestamptz not null default now()
);

create index if not exists login_events_recent_idx  on login_events (created_at desc);
create index if not exists login_events_profile_idx on login_events (profile_id, created_at desc);

alter table login_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename='login_events' and policyname='login_events_admin_read') then
    create policy login_events_admin_read on login_events
      for select using (is_admin());
  end if;
end $$;

-- Same reasoning as auth_email_requests: this holds email addresses and the
-- write path has to be reachable before a session exists, so anon gets no
-- direct access at all and goes through the function below.
revoke all on public.login_events from anon;

-- ------------------------------------------------------------------ recording
--
-- Callable by anon because a failed sign-in has no session by definition.
-- Resolves the profile from auth.uid() when there is one, so the caller cannot
-- claim to be somebody else -- the email argument is only used for the failure
-- case, where nothing is authenticated yet and it is all we have.
create or replace function record_login_event(
  p_event   text,
  p_method  text default 'unknown',
  p_email   text default null,
  p_reason  text default null,
  p_ip_hash text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  -- Ceiling on rows per hour: this is an unauthenticated write path, so it must
  -- not be able to grow the table without bound on a 500MB free tier.
  insert_ceiling constant int := 500;
  v_uid uuid := auth.uid();
  v_rows_this_hour int;
begin
  if p_event not in ('signed_in', 'denied', 'failed', 'signed_out') then
    return;  -- never raise: tracking must not be able to break sign-in
  end if;

  select count(*) into v_rows_this_hour
    from login_events where created_at > now() - interval '1 hour';
  if v_rows_this_hour >= insert_ceiling then
    return;
  end if;

  delete from login_events where created_at < now() - interval '90 days';

  insert into login_events (profile_id, email, event, method, reason, ip_hash)
  values (
    (select id from profiles where id = v_uid),
    -- Prefer the authenticated identity; fall back to what was supplied.
    coalesce((select email from profiles where id = v_uid), lower(nullif(trim(p_email), ''))),
    p_event,
    coalesce(nullif(p_method, ''), 'unknown'),
    -- Truncated: Supabase error strings can be long and this is a label, not a log.
    left(nullif(trim(p_reason), ''), 200),
    p_ip_hash
  );
end;
$$;

grant execute on function record_login_event(text, text, text, text, text) to anon, authenticated;

-- ------------------------------------------------------- street geocoding
-- Keeps "set the coordinates" and "recompute the area" from coming apart.
-- Called only by the `geocode` Edge Function, which validates the point first.
-- See supabase/migrations/011_set_company_point.sql.

create or replace function set_company_point(p_id uuid, p_lat double precision, p_lon double precision)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  update companies
     set latitude      = p_lat,
         longitude     = p_lon,
         geo_precision = 'address',
         area          = ez_area(p_lat, p_lon)
   where id = p_id;
end;
$$;

revoke execute on function set_company_point(uuid, double precision, double precision)
  from anon, authenticated, public;

-- ---------------------------------------------------------------- bootstrap
-- Replace with your own address, run it, then sign in once to create your user.
-- After that, promote yourself:
--   update profiles set role = 'admin' where email = 'you@example.com';

-- insert into allowed_emails (email, note) values ('you@example.com', 'founder');
