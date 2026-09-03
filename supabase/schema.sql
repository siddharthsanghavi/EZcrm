-- EZcrm schema. Run this once in the Supabase SQL editor.
-- Security model: an email must be in `allowed_emails` before a profile is created
-- for it. Every table's RLS policy requires a profile row, so a stranger who signs
-- up sees an empty database rather than your data.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------- access control

create table allowed_emails (
  email      text primary key,
  note       text,
  -- What this address becomes on first sign-in, so an invited viewer never
  -- spends a day as a member.
  role       text not null default 'member' check (role in ('viewer', 'member', 'admin')),
  added_at   timestamptz not null default now()
);

create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text not null unique,
  full_name  text,
  role       text not null default 'member' check (role in ('viewer', 'member', 'admin')),
  created_at timestamptz not null default now()
);

-- Fires when someone completes a magic-link signup. Only mints a profile if their
-- address was pre-approved, so the allowlist is the single gate into the app.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare invited text;
begin
  select role into invited from allowed_emails where lower(email) = lower(new.email);

  if invited is not null then
    insert into profiles (id, email, full_name, role)
    values (new.id, new.email, new.raw_user_meta_data ->> 'full_name', invited)
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
-- Two questions, deliberately separate. has_access() is "has a profile at all"
-- and backs every read policy; is_member() is "may write" and backs every write
-- policy. That split is the viewer role, so a new table whose read policy calls
-- is_member() by habit will quietly deny viewers, and one whose write policy
-- calls has_access() will quietly let them write.
create or replace function has_access()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;

create or replace function is_member()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('member', 'admin'));
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
grant execute on function has_access() to anon, authenticated;
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
  for select using (has_access());
create policy profiles_self_update on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- The club shares one workspace: any member reads and writes any record. Deletes
-- are narrower, since that's the operation you can't undo from the UI.
do $$
declare t text;
begin
  foreach t in array array['companies', 'contacts', 'activities', 'tasks'] loop
    execute format('create policy %1$s_read on %1$s for select using (has_access())', t);
    execute format('create policy %1$s_insert on %1$s for insert with check (is_member())', t);
    execute format('create policy %1$s_update on %1$s for update using (is_member()) with check (is_member())', t);
    execute format(
      'create policy %1$s_delete on %1$s for delete using (is_admin() or created_by = auth.uid())', t);
  end loop;
end;
$$;

-- Companies are the exception: deleting one takes its contacts, activity and
-- tasks with it, so only admins may. Everyone else files a request against
-- deletion_requests below.
drop policy if exists companies_delete on companies;
create policy companies_delete on companies for delete using (is_admin());

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
    create policy status_events_read on status_events for select using (has_access());
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
  if new_role not in ('viewer', 'member', 'admin') then
    raise exception 'Invalid role';
  end if;

  -- Never leave the club without an admin. Demoting to viewer counts too.
  if new_role <> 'admin' then
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
      for select using (has_access() and (shared or owner_id = auth.uid()));
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

-- --------------------------------------------------------- map regions
-- Groups companies into named areas for the map's zoomed-out view. Replace
-- the rows in the function with your own regions -- see
-- supabase/migrations/005_map_grouping.sql.

alter table companies add column if not exists area text;
create index if not exists companies_area_idx on companies (area);

create or replace function ez_area(lat double precision, lon double precision)
returns text
language sql
immutable
as $$
  select a.name
  from (values
    -- name,                     latitude, longitude
    ('Metro Atlanta',            33.7550, -84.3900),
    ('Northwest',                34.6000, -85.0000),
    ('Northeast',                34.3500, -83.5500),
    ('Athens Area',              33.9600, -83.3800),
    ('Augusta / CSRA',           33.4700, -82.0000),
    ('Columbus / West',          32.4600, -84.9900),
    ('Middle',                   32.8400, -83.6300),
    ('Southwest',                31.5800, -84.1600),
    ('South',                    30.8300, -83.2800),
    ('Southeast',                31.5000, -82.3000),
    ('Savannah / Coastal',       32.0800, -81.0900),
    ('Brunswick / Golden Isles', 31.1500, -81.4900)
  ) as a(name, alat, alon)
  where lat is not null and lon is not null
  -- Planar approximation is plenty at this scale, and keeps the function
  -- immutable so it can back an index or generated column later.
  order by ((lat - a.alat) * 111) ^ 2 + ((lon - a.alon) * 93) ^ 2
  limit 1;
$$;

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


-- ------------------- deletions, the contact tree, and the activity feed
-- Everything the club does to the data is recorded, deleting a company is a
-- request members file rather than an act they perform, and contacts carry a
-- reporting line. The roles and read policies these rely on are above; this is
-- the part that adds new objects. See
-- supabase/migrations/013_deletions_audit_roles_and_org_chart.sql.

-- Deliberately NO foreign key to companies: the point is to outlive the
-- company. `snapshot` keeps the row as it was, so an accidental deletion can be
-- retyped from the log rather than reconstructed from memory.
create table if not exists company_deletions (
  id             uuid primary key default uuid_generate_v4(),
  company_id     uuid not null,
  company_name   text not null,
  snapshot       jsonb not null,
  deleted_by     uuid references profiles on delete set null,
  deleted_at     timestamptz not null default clock_timestamp(),
  -- Copied off the pending request as it cascades away, so the log can still
  -- answer "who asked for this?" long after the request row is gone.
  requested_by   uuid references profiles on delete set null,
  request_reason text
);

create index if not exists company_deletions_recent_idx on company_deletions (deleted_at desc);

alter table company_deletions enable row level security;

do $$
begin
  -- Club-visible, like the status history: the log is only useful if the person
  -- wondering where a company went can read it.
  if not exists (select 1 from pg_policies
                  where tablename='company_deletions' and policyname='company_deletions_read') then
    create policy company_deletions_read on company_deletions for select using (has_access());
  end if;
end $$;

-- No insert/update/delete policy at all: rows arrive only through the security
-- definer trigger below. An append-only log nobody can edit.

create table if not exists deletion_requests (
  id            uuid primary key default uuid_generate_v4(),
  -- Cascades: an approved request's company is gone, and so is the request.
  -- What happened is recorded in company_deletions, which does not cascade.
  company_id    uuid not null references companies on delete cascade,
  requested_by  uuid references profiles on delete set null,
  requested_at  timestamptz not null default now(),
  reason        text,
  status        text not null default 'pending'
                  check (status in ('pending', 'declined', 'withdrawn')),
  decided_by    uuid references profiles on delete set null,
  decided_at    timestamptz,
  decision_note text
);

-- One live request per company. A second member asking for the same deletion
-- should join the existing request, not open a competing one.
create unique index if not exists deletion_requests_one_pending
  on deletion_requests (company_id) where status = 'pending';
create index if not exists deletion_requests_recent_idx on deletion_requests (requested_at desc);

alter table deletion_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename='deletion_requests' and policyname='deletion_requests_read') then
    create policy deletion_requests_read on deletion_requests for select using (has_access());
  end if;

  -- You can only file a request in your own name, and only as pending: an
  -- already-decided request would be a decision nobody made.
  if not exists (select 1 from pg_policies
                  where tablename='deletion_requests' and policyname='deletion_requests_insert') then
    create policy deletion_requests_insert on deletion_requests
      for insert with check (is_member() and requested_by = auth.uid() and status = 'pending');
  end if;

  -- Withdrawing your own request is the only update a member can make directly.
  -- An admin's decision goes through decide_deletion_request() below, so that
  -- `decided_by` is whoever actually decided rather than whoever typed it.
  if not exists (select 1 from pg_policies
                  where tablename='deletion_requests' and policyname='deletion_requests_withdraw') then
    create policy deletion_requests_withdraw on deletion_requests
      for update using (requested_by = auth.uid() and status = 'pending')
      with check (requested_by = auth.uid() and status = 'withdrawn');
  end if;
end $$;

-- A trigger rather than application code, for the same reason status changes
-- are: it fires wherever the delete comes from -- the UI, the SQL editor, a
-- cascade -- and cannot be forgotten at a call site. BEFORE DELETE, so the
-- pending request is still there to be read.
create or replace function log_company_deletion()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare req record;
begin
  select requested_by, reason into req
  from deletion_requests
  where company_id = old.id and status = 'pending'
  limit 1;

  insert into company_deletions
    (company_id, company_name, snapshot, deleted_by, requested_by, request_reason)
  values
    (old.id, old.name, to_jsonb(old), auth.uid(), req.requested_by, req.reason);

  return old;
end;
$$;

revoke execute on function log_company_deletion() from anon, authenticated, public;

drop trigger if exists companies_deletion_log on companies;
create trigger companies_deletion_log
  before delete on companies
  for each row execute function log_company_deletion();

-- Declining is a write a member must not be able to forge, so it goes through a
-- checked function -- the same shape as set_member_role(). Approving needs no
-- function: an admin simply deletes the company, and the trigger above records
-- the request that prompted it.
create or replace function decide_deletion_request(request uuid, note text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'Only admins can decide deletion requests';
  end if;

  update deletion_requests
     set status = 'declined',
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = note
   where id = request and status = 'pending';
end;
$$;

revoke execute on function decide_deletion_request(uuid, text) from anon, public;
grant execute on function decide_deletion_request(uuid, text) to authenticated;

-- ======================================================= 4. the contact tree

-- `reports_to` is a self-reference, which makes an org chart. `division` is free
-- text, because a club cannot know in advance whether a company splits into
-- Operations and Marketing or into North Plant and South Plant, and a fixed list
-- would be wrong at the first company that does it differently.
--
-- on delete set null, not cascade: deleting a manager must orphan their reports
-- upward, not delete the team.
alter table contacts add column if not exists reports_to uuid references contacts(id) on delete set null;
alter table contacts add column if not exists division text;

create index if not exists contacts_reports_to_idx on contacts (reports_to);
create index if not exists contacts_company_division_idx on contacts (company_id, division);

create or replace function check_contact_reporting()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  cursor_id uuid;
  manager_company uuid;
  hops int := 0;
begin
  if new.reports_to is null then
    return new;
  end if;

  if new.reports_to = new.id then
    raise exception 'A contact cannot report to themselves';
  end if;

  select company_id into manager_company from contacts where id = new.reports_to;

  -- Both null (two unattached contacts) is fine; one null is not, and neither
  -- is a mismatch. `is distinct from` handles the nulls without three branches.
  if manager_company is distinct from new.company_id then
    raise exception 'A contact can only report to someone at the same company';
  end if;

  -- Walk up from the proposed manager. Reaching this contact means the edit
  -- would close a loop. The hop cap is a backstop: a cycle that already exists
  -- in the data (from before this migration) would otherwise spin forever.
  cursor_id := new.reports_to;
  while cursor_id is not null and hops < 100 loop
    if cursor_id = new.id then
      raise exception 'That would create a reporting loop';
    end if;
    select reports_to into cursor_id from contacts where id = cursor_id;
    hops := hops + 1;
  end loop;

  return new;
end;
$$;

revoke execute on function check_contact_reporting() from anon, authenticated, public;

drop trigger if exists contacts_reporting_check on contacts;
create trigger contacts_reporting_check
  before insert or update of reports_to, company_id on contacts
  for each row execute function check_contact_reporting();
-- ====================================================== 5. activity feed

create table if not exists audit_events (
  id         uuid primary key default uuid_generate_v4(),
  -- clock_timestamp(), not now(): several events can share a transaction (a
  -- bulk assign, a cascade) and now() would give them all one timestamp and an
  -- arbitrary order.
  at         timestamptz not null default clock_timestamp(),
  -- Null when nobody was signed in -- the geocode function, a SQL editor
  -- session. The UI says "automatically" rather than inventing a name.
  actor      uuid references profiles on delete set null,
  entity     text not null check (entity in ('company', 'contact', 'task', 'activity',
                                            'deletion_request', 'member', 'data',
                                            'template', 'setting')),
  action     text not null check (action in (
               'created', 'updated', 'deleted', 'status_changed', 'assigned',
               'tier_changed', 'completed', 'reopened', 'requested', 'declined',
               'withdrawn', 'invited', 'removed', 'role_changed', 'renamed',
               'imported', 'exported')),
  entity_id  uuid,
  -- No foreign key, for the same reason company_deletions has none: an event
  -- about a deleted company has to outlive the company.
  company_id uuid,
  summary    text not null,
  details    jsonb
);

-- `create table if not exists` above does nothing when the table is already
-- there, which means a database created before 'template' and 'setting' existed
-- keeps the older CHECK and refuses those rows at runtime -- a trigger failing
-- on a settings change, long after this file appeared to succeed. Reconciling
-- explicitly is the only way an upgrade and a fresh install end up identical.
alter table audit_events drop constraint if exists audit_events_entity_check;
alter table audit_events add constraint audit_events_entity_check
  check (entity in ('company', 'contact', 'task', 'activity',
                    'deletion_request', 'member', 'data', 'template', 'setting'));

alter table audit_events drop constraint if exists audit_events_action_check;
alter table audit_events add constraint audit_events_action_check
  check (action in ('created', 'updated', 'deleted', 'status_changed', 'assigned',
                    'tier_changed', 'completed', 'reopened', 'requested', 'declined',
                    'withdrawn', 'invited', 'removed', 'role_changed', 'renamed',
                    'imported', 'exported'));

create index if not exists audit_events_recent_idx  on audit_events (at desc);
create index if not exists audit_events_company_idx on audit_events (company_id, at desc);
create index if not exists audit_events_actor_idx   on audit_events (actor, at desc);

alter table audit_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename='audit_events' and policyname='audit_events_read') then
    create policy audit_events_read on audit_events for select using (has_access());
  end if;
end $$;

-- Append-only: no insert/update/delete policy, so rows can only arrive through
-- the security definer triggers below.

create or replace function audit_log(
  p_entity text, p_action text, p_entity_id uuid, p_company_id uuid,
  p_summary text, p_details jsonb default null)
returns void
language sql
security definer set search_path = public, pg_temp
as $$
  insert into audit_events (actor, entity, action, entity_id, company_id, summary, details)
  values (auth.uid(), p_entity, p_action, p_entity_id, p_company_id, p_summary, p_details);
$$;

revoke execute on function audit_log(text, text, uuid, uuid, text, jsonb) from anon, authenticated, public;

-- Columns the database maintains for itself. An event for each of these would
-- mean every logged call also produced "someone updated this company", which is
-- noise standing exactly where the signal should be.
create or replace function audit_ignored_column(col text)
returns boolean
language sql
immutable
as $$
  select col in ('updated_at', 'last_touch_at', 'tier_rank', 'area', 'geo_precision');
$$;

-- Which real fields changed, as a text[] -- for the "edited (city, phone)" tail
-- that makes an update event worth reading.
create or replace function audit_changed_fields(before jsonb, after jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(key order by key), '{}')
  from jsonb_each(after)
  where not audit_ignored_column(key)
    and value is distinct from (before -> key);
$$;

create or replace function audit_company()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare changed text[];
begin
  if tg_op = 'INSERT' then
    perform audit_log('company', 'created', new.id, new.id,
                      format('Added %s', new.name),
                      jsonb_build_object('status', new.status, 'tier', new.tier));

  elsif tg_op = 'DELETE' then
    perform audit_log('company', 'deleted', old.id, old.id,
                      format('Deleted %s', old.name), null);

  else
    -- Status, owner and tier get their own actions: they are the three things
    -- people scan a feed for, and "edited" would hide them among the rest.
    if new.status is distinct from old.status then
      -- Written as words, not as the stored enum: this sentence is read by
      -- people, and "in_conversation" is a column value, not English.
      perform audit_log('company', 'status_changed', new.id, new.id,
                        format('%s: %s → %s', new.name,
                               initcap(replace(old.status, '_', ' ')),
                               initcap(replace(new.status, '_', ' '))),
                        jsonb_build_object('from', old.status, 'to', new.status));
    end if;

    if new.owner_id is distinct from old.owner_id then
      perform audit_log('company', 'assigned', new.id, new.id,
        case
          when new.owner_id is null then format('Unassigned %s', new.name)
          else format('Assigned %s to %s', new.name,
                      coalesce((select coalesce(full_name, email) from profiles where id = new.owner_id), 'someone'))
        end,
        jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
    end if;

    if new.tier is distinct from old.tier then
      perform audit_log('company', 'tier_changed', new.id, new.id,
                        format('%s: %s', new.name, coalesce(new.tier, 'unrated')),
                        jsonb_build_object('from', old.tier, 'to', new.tier));
    end if;

    -- Everything else, as one event listing the fields.
    changed := audit_changed_fields(to_jsonb(old), to_jsonb(new));
    changed := array_remove(array_remove(array_remove(changed, 'status'), 'owner_id'), 'tier');

    if array_length(changed, 1) > 0 then
      perform audit_log('company', 'updated', new.id, new.id,
                        format('Edited %s (%s)', new.name, array_to_string(changed, ', ')),
                        jsonb_build_object('fields', changed));
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function audit_company() from anon, authenticated, public;

drop trigger if exists companies_audit on companies;
create trigger companies_audit
  after insert or update or delete on companies
  for each row execute function audit_company();

-- A company delete cascades to its contacts, activities and tasks. Auditing
-- each of those would turn one deliberate act into thirty lines of feed, all
-- saying something the "Deleted X" line above already said. So the child
-- triggers stay quiet when their company has just gone: inside the cascade the
-- parent row is already deleted, which is exactly what this checks.
create or replace function audit_parent_gone(p_company_id uuid)
returns boolean
language sql
security definer set search_path = public, pg_temp
stable
as $$
  select p_company_id is not null and not exists (select 1 from companies where id = p_company_id);
$$;

revoke execute on function audit_parent_gone(uuid) from anon, authenticated, public;

------------------------------------------------------------------- the feed
--
-- "Edited contact Priya Nair (reports_to)" is
-- true and unreadable -- a uuid column name where a person's name belongs -- so
-- reporting and division changes get their own sentences.
create or replace function audit_contact()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  who text;
  changed text[];
  manager text;
begin
  if tg_op = 'DELETE' then
    if audit_parent_gone(old.company_id) then return old; end if;
    who := trim(concat_ws(' ', old.first_name, old.last_name));
    perform audit_log('contact', 'deleted', old.id, old.company_id,
                      format('Removed contact %s', who), null);
    return old;
  end if;

  who := trim(concat_ws(' ', new.first_name, new.last_name));

  if tg_op = 'INSERT' then
    perform audit_log('contact', 'created', new.id, new.company_id,
                      format('Added contact %s', who),
                      jsonb_build_object('title', new.title, 'division', new.division));
    return new;
  end if;

  if new.reports_to is distinct from old.reports_to then
    select trim(concat_ws(' ', first_name, last_name)) into manager
    from contacts where id = new.reports_to;

    perform audit_log('contact', 'updated', new.id, new.company_id,
      case
        when manager is null then format('%s no longer reports to anyone', who)
        else format('%s now reports to %s', who, manager)
      end,
      jsonb_build_object('from', old.reports_to, 'to', new.reports_to));
  end if;

  if new.division is distinct from old.division then
    perform audit_log('contact', 'updated', new.id, new.company_id,
      case
        when new.division is null then format('%s is no longer in a division', who)
        else format('%s moved to %s', who, new.division)
      end,
      jsonb_build_object('from', old.division, 'to', new.division));
  end if;

  -- Everything else, as one event listing the fields.
  changed := audit_changed_fields(to_jsonb(old), to_jsonb(new));
  changed := array_remove(array_remove(changed, 'reports_to'), 'division');

  if array_length(changed, 1) > 0 then
    perform audit_log('contact', 'updated', new.id, new.company_id,
                      format('Edited contact %s (%s)', who, array_to_string(changed, ', ')),
                      jsonb_build_object('fields', changed));
  end if;

  return new;
end;
$$;

revoke execute on function audit_contact() from anon, authenticated, public;

drop trigger if exists contacts_audit on contacts;
create trigger contacts_audit
  after insert or update or delete on contacts
  for each row execute function audit_contact();

create or replace function audit_task()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if audit_parent_gone(old.company_id) then return old; end if;
    perform audit_log('task', 'deleted', old.id, old.company_id,
                      format('Deleted task: %s', old.title), null);
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform audit_log('task', 'created', new.id, new.company_id,
                      format('Added task: %s', new.title),
                      jsonb_build_object('due_date', new.due_date));

  elsif new.done is distinct from old.done then
    -- Ticking a task off is the single most common write in the app, and the
    -- one people most want to see happening.
    perform audit_log('task', case when new.done then 'completed' else 'reopened' end,
                      new.id, new.company_id,
                      format('%s: %s', case when new.done then 'Completed' else 'Reopened' end, new.title),
                      null);

  elsif array_length(audit_changed_fields(to_jsonb(old), to_jsonb(new)), 1) > 0 then
    perform audit_log('task', 'updated', new.id, new.company_id,
                      format('Edited task: %s', new.title), null);
  end if;

  return new;
end;
$$;

revoke execute on function audit_task() from anon, authenticated, public;

drop trigger if exists tasks_audit on tasks;
create trigger tasks_audit
  after insert or update or delete on tasks
  for each row execute function audit_task();

-- The manual log is itself an action: "Ada logged a call" belongs in the same
-- stream as "Ada finished a task", even though the call already has its own row.
create or replace function audit_activity()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if audit_parent_gone(old.company_id) then return old; end if;
    perform audit_log('activity', 'deleted', old.id, old.company_id,
                      format('Deleted %s log: %s', old.type, coalesce(old.subject, 'note')), null);
    return old;
  end if;

  perform audit_log('activity', 'created', new.id, new.company_id,
                    format('Logged %s: %s', new.type, coalesce(new.subject, 'note')),
                    jsonb_build_object('type', new.type));
  return new;
end;
$$;

revoke execute on function audit_activity() from anon, authenticated, public;

drop trigger if exists activities_audit on activities;
create trigger activities_audit
  after insert or delete on activities
  for each row execute function audit_activity();

create or replace function audit_deletion_request()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare co text;
begin
  select name into co from companies where id = new.company_id;

  if tg_op = 'INSERT' then
    perform audit_log('deletion_request', 'requested', new.id, new.company_id,
                      format('Requested deletion of %s', coalesce(co, 'a company')),
                      jsonb_build_object('reason', new.reason));

  elsif new.status is distinct from old.status and new.status in ('declined', 'withdrawn') then
    perform audit_log('deletion_request', new.status, new.id, new.company_id,
                      format('%s the deletion request for %s',
                             initcap(new.status), coalesce(co, 'a company')),
                      jsonb_build_object('note', new.decision_note));
  end if;

  return new;
end;
$$;

revoke execute on function audit_deletion_request() from anon, authenticated, public;

drop trigger if exists deletion_requests_audit on deletion_requests;
create trigger deletion_requests_audit
  after insert or update on deletion_requests
  for each row execute function audit_deletion_request();

-- ------------------------------------------------------------------- members

-- The allowlist is the actual gate: an address on it can sign in, one off it
-- cannot. Both directions are worth a line in the feed.
create or replace function audit_allowed_email()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform audit_log('member', 'invited', null, null,
                      format('Invited %s as %s', new.email, new.role),
                      jsonb_build_object('email', new.email, 'role', new.role, 'note', new.note));
  else
    perform audit_log('member', 'removed', null, null,
                      format('Removed %s from the allowlist', old.email),
                      jsonb_build_object('email', old.email));
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function audit_allowed_email() from anon, authenticated, public;

drop trigger if exists allowed_emails_audit on allowed_emails;
create trigger allowed_emails_audit
  after insert or delete on allowed_emails
  for each row execute function audit_allowed_email();

create or replace function audit_profile()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- Not a sign-in: this fires once, when an invited address first becomes a
    -- real account. The sign-ins themselves stay in login_events.
    perform audit_log('member', 'created', new.id, null,
                      format('%s joined as %s', coalesce(new.full_name, new.email), new.role),
                      jsonb_build_object('email', new.email, 'role', new.role));

  elsif tg_op = 'DELETE' then
    perform audit_log('member', 'removed', old.id, null,
                      format('%s lost access', coalesce(old.full_name, old.email)),
                      jsonb_build_object('email', old.email));

  else
    if new.role is distinct from old.role then
      perform audit_log('member', 'role_changed', new.id, null,
                        format('%s is now %s (was %s)',
                               coalesce(new.full_name, new.email), new.role, old.role),
                        jsonb_build_object('from', old.role, 'to', new.role));
    end if;

    -- Worth recording so a name appearing on old activity can be explained,
    -- but not worth a line when it is first set from nothing.
    if new.full_name is distinct from old.full_name and old.full_name is not null then
      perform audit_log('member', 'renamed', new.id, null,
                        format('%s is now called %s', old.full_name,
                               coalesce(new.full_name, new.email)),
                        jsonb_build_object('from', old.full_name, 'to', new.full_name));
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function audit_profile() from anon, authenticated, public;

drop trigger if exists profiles_audit on profiles;
create trigger profiles_audit
  after insert or update or delete on profiles
  for each row execute function audit_profile();

-- --------------------------------------------------------- imports & exports

-- Called by the application, not by a trigger, and this is the one place that
-- is right: an export is a SELECT, so there is nothing for a trigger to fire
-- on, and an import is one deliberate act that happens to be a thousand
-- inserts. The app knows both facts; the table does not.
--
-- has_access(), not is_member(): a viewer may export -- reading is what the
-- role is for -- and the point of the log is that we can see they did.
-- p_rows is clamped and the label is whitelisted, so a caller cannot write an
-- arbitrary sentence into the club's audit trail.
create or replace function log_data_transfer(p_action text, p_table text, p_rows int)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare verb text;
begin
  if not has_access() then
    raise exception 'Not a member';
  end if;
  if p_action not in ('imported', 'exported') then
    raise exception 'Invalid transfer action';
  end if;
  if p_table not in ('companies', 'contacts', 'activities') then
    raise exception 'Unknown table';
  end if;

  verb := case p_action when 'imported' then 'Imported' else 'Exported' end;

  perform audit_log('data', p_action, null, null,
                    format('%s %s %s', verb, greatest(coalesce(p_rows, 0), 0), p_table),
                    jsonb_build_object('table', p_table, 'rows', greatest(coalesce(p_rows, 0), 0)));
end;
$$;

revoke execute on function log_data_transfer(text, text, int) from anon, public;
grant execute on function log_data_transfer(text, text, int) to authenticated;


-- ========================================================== 6. settings

-- Key/value rather than a column per setting: these are read as a whole by one
-- page and never queried across, so a table that needs a migration for every new
-- preference buys nothing. Members read; only admins change club-wide settings,
-- because they appear in everybody's outgoing mail.
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references profiles on delete set null,
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='settings' and policyname='settings_read') then
    create policy settings_read on settings for select using (has_access());
  end if;
  if not exists (select 1 from pg_policies where tablename='settings' and policyname='settings_write') then
    create policy settings_write on settings for all using (is_admin()) with check (is_admin());
  end if;
end $$;

-- /privacy and /terms are public -- Google's OAuth reviewer fetches them, and a
-- policy behind a login is worth nothing to the person it is written for. They
-- name the club and give a contact address, and both now come from this row
-- rather than from the source, so a public repository carries neither.
--
-- Only this one key is readable without a session. NOTHING PRIVATE GOES IN THE
-- 'club' ROW: it is, by design, world-readable. Any other key stays behind
-- has_access() through the policy above.
do $$
begin
  if not exists (select 1 from pg_policies where tablename='settings' and policyname='settings_public_club') then
    create policy settings_public_club on settings for select using (key = 'club');
  end if;
end $$;

-- The club's own details, merged into every outgoing draft. Seeded with visible
-- placeholders on purpose: a draft that says [YOUR CLUB] is obviously
-- unfinished, whereas one that says "the Engineering Society" is wrong in a way
-- somebody will send by accident.
insert into settings (key, value)
values ('club', jsonb_build_object(
  'clubName', '[YOUR CLUB]',
  'school', '[YOUR SCHOOL]',
  'groupSize', '[GROUP SIZE]',
  'visitLength', '[LENGTH]',
  -- Shown on /privacy and /terms as the address to write to. Public.
  'contactEmail', ''
))
on conflict (key) do nothing;

-- The standard letters. Bodies carry {{merge_fields}} filled in per company at
-- draft time -- lib/cold-email.ts lists them and is the only place that knows
-- what each one means.
create table if not exists email_templates (
  id          uuid primary key default uuid_generate_v4(),
  slug        text not null unique,
  name        text not null,
  -- When to reach for it. Shown under the picker, so it is guidance for the
  -- member choosing rather than part of the letter.
  guidance    text,
  subject     text not null,
  body        text not null,
  sort        int not null default 100,
  -- Offered first for companies at this status. Null means never suggested,
  -- only chosen by hand.
  suggest_for text,
  created_by  uuid references profiles on delete set null,
  updated_by  uuid references profiles on delete set null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists email_templates_sort_idx on email_templates (sort, name);

alter table email_templates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='email_templates' and policyname='email_templates_read') then
    create policy email_templates_read on email_templates for select using (has_access());
  end if;
  -- Any member may improve a letter: they are the ones sending them, and every
  -- edit lands in the activity feed with a name against it.
  if not exists (select 1 from pg_policies where tablename='email_templates' and policyname='email_templates_insert') then
    create policy email_templates_insert on email_templates for insert with check (is_member());
  end if;
  if not exists (select 1 from pg_policies where tablename='email_templates' and policyname='email_templates_update') then
    create policy email_templates_update on email_templates for update using (is_member()) with check (is_member());
  end if;
  -- Deleting the club's standard letter is the one that deserves a second thought.
  if not exists (select 1 from pg_policies where tablename='email_templates' and policyname='email_templates_delete') then
    create policy email_templates_delete on email_templates for delete using (is_admin() or created_by = auth.uid());
  end if;
end $$;

create or replace function touch_email_template()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke execute on function touch_email_template() from anon, authenticated, public;

drop trigger if exists email_templates_touch on email_templates;
create trigger email_templates_touch
  before update on email_templates
  for each row execute function touch_email_template();

-- One function for both tables: the shapes differ but the sentence does not,
-- and two nearly identical trigger functions would drift apart.
create or replace function audit_settings()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'settings' then
    perform audit_log('setting', 'updated', null, null,
                      format('Changed the %s settings', coalesce(new.key, old.key)), null);
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    perform audit_log('template', 'created', new.id, null,
                      format('Added the "%s" email template', new.name), null);
  elsif tg_op = 'DELETE' then
    perform audit_log('template', 'deleted', old.id, null,
                      format('Deleted the "%s" email template', old.name), null);
  elsif new.subject is distinct from old.subject or new.body is distinct from old.body
     or new.name is distinct from old.name or new.guidance is distinct from old.guidance then
    perform audit_log('template', 'updated', new.id, null,
                      format('Edited the "%s" email template', new.name), null);
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function audit_settings() from anon, authenticated, public;

drop trigger if exists settings_audit on settings;
create trigger settings_audit
  after insert or update on settings
  for each row execute function audit_settings();

drop trigger if exists email_templates_audit on email_templates;
create trigger email_templates_audit
  after insert or update or delete on email_templates
  for each row execute function audit_settings();

-- The four letters, as skeletons rather than finished writing.
--
-- What a club actually sends is its own voice, tuned over a season, and it
-- promises specific things: how many students, how long, what you will sign.
-- Shipping one club's letters as another club's default is how a group ends up
-- sending a stranger a promise it never made. So these carry the shape, the
-- merge fields and square-bracket prompts, and the writing is yours.
--
-- Edit them at /settings once this is applied, or paste a set you already have
-- into the Markdown import there. supabase/email-templates.example.md shows the
-- format. A re-run never overwrites what somebody has since changed.
insert into email_templates (slug, name, guidance, subject, body, sort, suggest_for)
values
  ('tour', 'Ask for a tour', 'First approach, when you want to visit.',
   'Student visit to {{company}}?', E'{{greeting}}\n\nI am {{my_name}}, from {{club}} at {{school}}. [Say in a sentence who you are and why a visit is worth their morning.]\n\nI am writing to ask whether {{company}} would consider hosting us at {{site}}. We are interested in your work in {{what_they_do}}.\n\nWhat we would ask for:\n\n- About {{group_size}} students, plus one member of staff\n- Roughly {{visit_length}}, on a weekday that suits you\n- [Anything else you need]\n\n[What you bring: briefed students, whatever agreement you will sign, how you handle photographs.]\n\nWould you be open to it?\n\nThank you for your time,\n{{signature}}', 10, 'prospect'),
  ('sponsorship', 'Ask for sponsorship', 'First approach, when you want support.',
   '{{club}} at {{school}} — supporting {{group_size}} students', E'{{greeting}}\n\nI am {{my_name}}, writing on behalf of {{club}} at {{school}}. We are a student group of about {{group_size}}.\n\n[What the money or the help would pay for, and what a supporter gets in return.]\n\nI am contacting {{company}} because of your work in {{what_they_do}}.\n\n[Your ask, in one sentence.]\n\nThank you for reading,\n{{signature}}', 20, null),
  ('nudge', 'Nudge after silence', 'You wrote, nobody replied, it has been a fortnight.',
   'Following up: visiting {{company}}', E'{{greeting}}\n\nI wrote a couple of weeks ago about bringing a group of students from {{club}} at {{school}} to {{site}}, and I know a message like mine is easy to lose.\n\n[Make it easy to say no — that is what gets you an answer.]\n\nThanks either way,\n{{signature}}', 30, 'contacted'),
  ('reintro', 'New year, new committee', 'They hosted before, and the committee has changed.',
   '{{club}} — new committee, saying hello again', E'{{greeting}}\n\n{{company}} has worked with {{club}} at {{school}} before, and I wanted to reintroduce us: the committee changes every year, and I am this year''s.\n\n[Ask whether they are still willing, and give them an easy way out if not.]\n\nBest wishes,\n{{signature}}', 40, 'dormant')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------- bootstrap
-- Replace with your own address, run it, then sign in once to create your user.
-- After that, promote yourself:
--   update profiles set role = 'admin' where email = 'you@example.com';

-- insert into allowed_emails (email, note) values ('you@example.com', 'founder');
