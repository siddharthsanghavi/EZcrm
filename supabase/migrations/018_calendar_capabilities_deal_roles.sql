-- A calendar, capability tags on companies, and deal roles on contacts.
-- Safe to re-run; mirrored into supabase/schema.sql for fresh projects.
-- Purely additive: nothing existing is dropped or rewritten, so this can be
-- applied before the code that uses it is deployed.
--
--   1. events        -- tours, meetings, club events, deadlines, on a calendar
--   2. capabilities  -- what a company actually does: CNC, robotics, AS9100
--   3. deal roles    -- champion, decision-maker, technical contact, gatekeeper
--   4. audit         -- the new entity in the feed's vocabulary
--
-- Every policy uses the `(select fn())` form from 017. A bare call runs once per
-- row; see that migration for the measurements.

-- =========================================================== 1. events

-- The plant tour is the club's demo and the reason most companies are in here
-- at all, yet until now it existed only as a status change and a logged note,
-- with no date anyone could look ahead to.
--
-- company_id is nullable on purpose: a careers fair or a committee deadline is
-- on the club's calendar without belonging to any one company.
create table if not exists events (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid references companies on delete cascade,
  contact_id  uuid references contacts on delete set null,
  kind        text not null default 'tour',
  title       text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  location    text,
  notes       text,
  created_by  uuid references profiles on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Reconciled explicitly: `create table if not exists` skips constraint changes
-- on a database that already has the table.
alter table events drop constraint if exists events_kind_check;
alter table events add constraint events_kind_check
  check (kind in ('tour', 'meeting', 'event', 'deadline'));
alter table events drop constraint if exists events_ends_after_starts;
alter table events add constraint events_ends_after_starts
  check (ends_at is null or ends_at >= starts_at);

create index if not exists events_starts_idx  on events (starts_at);
create index if not exists events_company_idx on events (company_id, starts_at);
create index if not exists events_contact_idx on events (contact_id);
create index if not exists events_created_by_idx on events (created_by);

drop trigger if exists events_touch on events;
create trigger events_touch before update on events
  for each row execute function touch_updated_at();

alter table events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='events' and policyname='events_read') then
    create policy events_read on events for select using ((select has_access()));
  end if;
  if not exists (select 1 from pg_policies where tablename='events' and policyname='events_insert') then
    create policy events_insert on events for insert with check ((select is_member()));
  end if;
  if not exists (select 1 from pg_policies where tablename='events' and policyname='events_update') then
    create policy events_update on events for update
      using ((select is_member())) with check ((select is_member()));
  end if;
  -- Same rule as activities: you can take back your own entry, an admin can
  -- take back anyone's.
  if not exists (select 1 from pg_policies where tablename='events' and policyname='events_delete') then
    create policy events_delete on events for delete
      using ((select is_admin()) or created_by = (select auth.uid()));
  end if;
end $$;

-- ===================================================== 2. capabilities

-- Free text in an array, not a lookup table: a club's vocabulary is "PLC:
-- Allen-Bradley" and "AS9100", and making an admin define tags before anyone
-- may use one is how tags stop getting used. The app reuses an existing tag's
-- spelling when a new one matches it case-insensitively.
alter table companies add column if not exists capabilities text[] not null default '{}';
create index if not exists companies_capabilities_idx on companies using gin (capabilities);

-- Every tag in use and how many companies carry it, for the filter dropdown
-- and the tag editor's suggestions. SECURITY INVOKER, so it sees exactly what
-- the caller's RLS lets them see — nothing for a stranger.
create or replace function capability_counts()
returns table (tag text, companies bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select t.tag, count(*)
  from companies c, unnest(c.capabilities) as t(tag)
  where c.archived_at is null
  group by t.tag
  order by lower(t.tag);
$$;

revoke execute on function capability_counts() from anon, public;
grant execute on function capability_counts() to authenticated;

-- ======================================================= 3. deal roles

-- Who matters in getting to yes, which the org chart does not say: the person
-- who reports to the plant manager may be the one who actually wants you there.
alter table contacts add column if not exists deal_role text;
alter table contacts drop constraint if exists contacts_deal_role_check;
alter table contacts add constraint contacts_deal_role_check
  check (deal_role is null or deal_role in ('champion', 'decision_maker', 'technical', 'gatekeeper'));

-- ============================================================ 4. audit

alter table audit_events drop constraint if exists audit_events_entity_check;
alter table audit_events add constraint audit_events_entity_check
  check (entity in ('company', 'contact', 'task', 'activity',
                    'deletion_request', 'member', 'data', 'template', 'setting',
                    'attachment', 'location', 'event'));

-- The club's time zone (Settings → Club), for dates the database writes into
-- sentences. The database clock is UTC, so `to_char(starts_at)` alone puts a
-- 7pm tour in Georgia under tomorrow's date. An unknown zone must not make an
-- insert fail, so a bad value falls back to UTC rather than raising — and this
-- tests the name by using it, not by querying pg_timezone_names, which takes
-- half a second here.
create or replace function club_time_zone()
returns text
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare tz text;
begin
  select value->>'timeZone' into tz from settings where key = 'club';
  if tz is null or tz = '' then return 'UTC'; end if;
  perform now() at time zone tz;
  return tz;
exception when others then
  return 'UTC';
end;
$$;

revoke execute on function club_time_zone() from anon, authenticated, public;

create or replace function audit_event()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  changed text[];
  label text;
  tz text := club_time_zone();
begin
  if tg_op = 'DELETE' then
    if audit_parent_gone(old.company_id) then return old; end if;
    perform audit_log('event', 'deleted', old.id, old.company_id,
                      format('Cancelled %s', old.title), null);
    return old;
  end if;

  label := format('%s on %s', new.title, to_char(new.starts_at at time zone tz, 'Mon FMDD'));

  if tg_op = 'INSERT' then
    perform audit_log('event', 'created', new.id, new.company_id,
                      format('Scheduled %s', label),
                      jsonb_build_object('kind', new.kind, 'starts_at', new.starts_at));
    return new;
  end if;

  changed := audit_changed_fields(to_jsonb(old), to_jsonb(new));
  if array_length(changed, 1) is null then return new; end if;

  perform audit_log('event', 'updated', new.id, new.company_id,
                    format('Changed %s (%s)', label, array_to_string(changed, ', ')),
                    jsonb_build_object('fields', changed));
  return new;
end;
$$;

revoke execute on function audit_event() from anon, authenticated, public;

drop trigger if exists events_audit on events;
create trigger events_audit
  after insert or update or delete on events
  for each row execute function audit_event();
