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

  -- Directory fields. These come from the Georgia automation prospect list and
  -- are what you actually filter by when picking who to call this week.
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

-- ---------------------------------------------------------------- bootstrap
-- Replace with your own address, run it, then sign in once to create your user.
-- After that, promote yourself:
--   update profiles set role = 'admin' where email = 'you@example.com';

-- insert into allowed_emails (email, note) values ('you@example.com', 'founder');
