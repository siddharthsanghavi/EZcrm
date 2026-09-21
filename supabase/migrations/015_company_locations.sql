-- Multiple locations per company.
-- Safe to re-run; mirrored into supabase/schema.sql for fresh projects.
--
-- A company had exactly one place: `address, city, region, county, area,
-- latitude, longitude, geo_precision`, all columns on `companies`. That is
-- wrong for the half of this directory that is a manufacturer with three
-- plants — you call the head office, you tour the plant, and the map should
-- show you both.
--
-- So location moves out to its own table and those columns go. This is the
-- destructive half of the change: after this migration `companies` has no
-- location on it at all, and anything that read those columns reads
-- `company_locations` instead.
--
--   1. the table   -- company_locations, RLS, exactly-one-primary
--   2. backfill    -- one primary row per company, from the old columns
--   3. filtering   -- derived arrays so the list page can still filter
--   4. geocoding   -- set_company_point moves to a location
--   5. audit       -- locations are a thing that happened to a company
--   6. drop        -- the old columns, and the indexes that depended on them

-- ======================================================== 1. the table

create table if not exists company_locations (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references companies on delete cascade,
  -- What this place is: "Head office", "Plant 2", "Distribution centre".
  -- Nullable, because a company with one location rarely needs to name it.
  label       text,
  address     text,
  city        text,
  region      text,
  county      text,
  area        text,
  latitude    double precision,
  longitude   double precision,
  geo_precision text,
  -- Exactly one per company, enforced below. The primary location is the one
  -- that stands in wherever the app still has room for only one place — the
  -- list row, the search hit, the company header.
  is_primary  boolean not null default false,
  sort        integer not null default 0,
  created_by  uuid references profiles on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists company_locations_company_idx
  on company_locations (company_id, sort, created_at);
create index if not exists company_locations_region_idx on company_locations (region);
create index if not exists company_locations_area_idx on company_locations (area);
-- The map reads every located row in one query, so the partial index is the
-- one that matters.
create index if not exists company_locations_point_idx
  on company_locations (latitude, longitude) where latitude is not null;

-- One primary per company. A partial unique index says it once, and says it in
-- the database rather than in whichever code path forgot.
create unique index if not exists company_locations_one_primary
  on company_locations (company_id) where is_primary;

drop trigger if exists company_locations_touch on company_locations;
create trigger company_locations_touch before update on company_locations
  for each row execute function touch_updated_at();

alter table company_locations enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='company_locations' and policyname='company_locations_read') then
    create policy company_locations_read on company_locations for select using (has_access());
  end if;
  if not exists (select 1 from pg_policies where tablename='company_locations' and policyname='company_locations_insert') then
    create policy company_locations_insert on company_locations for insert with check (is_member());
  end if;
  if not exists (select 1 from pg_policies where tablename='company_locations' and policyname='company_locations_update') then
    create policy company_locations_update on company_locations for update using (is_member());
  end if;
  if not exists (select 1 from pg_policies where tablename='company_locations' and policyname='company_locations_delete') then
    create policy company_locations_delete on company_locations for delete using (is_member());
  end if;
end $$;

/**
 * Keep "exactly one primary" true without making every caller think about it.
 *
 * The unique index above rejects a second primary; on its own that just moves
 * the problem to the UI, which would have to clear the old one first and would
 * race with anyone else editing. Instead, setting a location primary demotes
 * the others, and the first location a company gets is primary by default.
 */
create or replace function company_locations_set_primary()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  -- The first location for a company is its primary, whatever the caller said.
  --
  -- INSERT only, and that guard is load-bearing. The demotion below re-enters
  -- this trigger for the row being demoted; on an INSERT the new row is not
  -- visible yet, so without the guard the demoted row would look like the
  -- company's only location, promote itself straight back, and the insert would
  -- then fail the one-primary unique index.
  if tg_op = 'INSERT'
     and not exists (select 1 from company_locations
                      where company_id = new.company_id
                        and id is distinct from new.id) then
    new.is_primary := true;
  end if;

  if new.is_primary then
    update company_locations
       set is_primary = false
     where company_id = new.company_id
       and id is distinct from new.id
       and is_primary;
  end if;

  return new;
end;
$$;

revoke execute on function company_locations_set_primary() from anon, authenticated, public;

drop trigger if exists company_locations_primary on company_locations;
create trigger company_locations_primary
  before insert or update of is_primary on company_locations
  for each row execute function company_locations_set_primary();

/**
 * Deleting the primary promotes the next one rather than leaving a company
 * with locations but no primary — a state every read path would have to
 * special-case forever.
 */
create or replace function company_locations_repromote()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if not old.is_primary then return old; end if;
  -- The company itself may be mid-cascade, in which case there is nothing to
  -- promote and nothing to fix.
  if not exists (select 1 from companies where id = old.company_id) then return old; end if;

  update company_locations
     set is_primary = true
   where id = (select id from company_locations
                where company_id = old.company_id
                order by sort, created_at
                limit 1);
  return old;
end;
$$;

revoke execute on function company_locations_repromote() from anon, authenticated, public;

drop trigger if exists company_locations_repromoted on company_locations;
create trigger company_locations_repromoted
  after delete on company_locations
  for each row execute function company_locations_repromote();

-- ========================================================== 2. backfill

-- One primary row per company that actually had a location. A company with
-- nothing but a name gets no row at all — an empty location is not a place,
-- and the map's "without a location" count depends on the difference.
--
-- Wrapped in a column-existence check, and executed dynamically, because
-- section 6 drops the columns this reads. On a second run they are gone, and a
-- plain statement naming `c.address` would fail to parse even though the guard
-- around it is false — plpgsql only plans the string when it runs it.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'companies'
                and column_name = 'address') then
    execute $sql$
      insert into company_locations (
        company_id, label, address, city, region, county, area,
        latitude, longitude, geo_precision, is_primary, created_by, created_at
      )
      select c.id, null, c.address, c.city, c.region, c.county, c.area,
             c.latitude, c.longitude, c.geo_precision, true, c.created_by, c.created_at
      from companies c
      where (c.address is not null or c.city is not null or c.region is not null
             or c.county is not null or c.area is not null or c.latitude is not null)
        and not exists (select 1 from company_locations l where l.company_id = c.id)
    $sql$;
  end if;
end $$;

-- ========================================================= 3. filtering

/**
 * The list page filters companies by region and searches them by city, with
 * exact counts and pagination. "Parent where any child matches" is the one
 * shape PostgREST cannot express without an inner join, and an inner join
 * returns a company once per matching location — which silently inflates both
 * the page and the count.
 *
 * So the regions and cities a company has are mirrored back onto it as arrays,
 * maintained by trigger. This is a derived index, not a second source of
 * truth: nothing writes it, `company_locations` is the only place a location
 * is edited, and a GIN index makes `location_regions @> '{Northwest}'` a
 * single-table lookup.
 */
alter table companies add column if not exists location_regions text[] not null default '{}';
alter table companies add column if not exists location_cities  text[] not null default '{}';

create index if not exists companies_location_regions_idx on companies using gin (location_regions);
create index if not exists companies_location_cities_idx  on companies using gin (location_cities);

-- The `is distinct from` guard is not an optimisation: without it, saving a
-- location without changing its city rewrites the parent company, which bumps
-- `updated_at` and wakes the company audit trigger for nothing.
create or replace function refresh_company_places(p_company_id uuid)
returns void
language sql
security definer set search_path = public, pg_temp
as $$
  with places as (
    select coalesce(array_agg(distinct l.region order by l.region)
                    filter (where l.region is not null), '{}') as regions,
           coalesce(array_agg(distinct l.city order by l.city)
                    filter (where l.city is not null), '{}') as cities
    from company_locations l
    where l.company_id = p_company_id
  )
  update companies c
     set location_regions = places.regions,
         location_cities  = places.cities
    from places
   where c.id = p_company_id
     and (c.location_regions is distinct from places.regions
       or c.location_cities  is distinct from places.cities);
$$;

revoke execute on function refresh_company_places(uuid) from anon, authenticated, public;

create or replace function company_locations_refresh_places()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform refresh_company_places(old.company_id);
    return old;
  end if;
  perform refresh_company_places(new.company_id);
  -- An edit that moves a location to another company has to fix both sides.
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    perform refresh_company_places(old.company_id);
  end if;
  return new;
end;
$$;

revoke execute on function company_locations_refresh_places() from anon, authenticated, public;

drop trigger if exists company_locations_places on company_locations;
create trigger company_locations_places
  after insert or update or delete on company_locations
  for each row execute function company_locations_refresh_places();

-- Seed the arrays for everything the backfill just inserted.
select refresh_company_places(id) from companies;

-- ========================================================= 4. geocoding

-- Geocoding now resolves one location, not one company. The Edge Function
-- still validates the point before calling this; what changed is that the
-- thing being placed on the map has its own id.
drop function if exists set_company_point(uuid, double precision, double precision);

create or replace function set_location_point(p_id uuid, p_lat double precision, p_lon double precision)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  update company_locations
     set latitude      = p_lat,
         longitude     = p_lon,
         geo_precision = 'address',
         area          = ez_area(p_lat, p_lon)
   where id = p_id;
end;
$$;

revoke execute on function set_location_point(uuid, double precision, double precision)
  from anon, authenticated, public;

-- ============================================================= 5. audit

alter table audit_events drop constraint if exists audit_events_entity_check;
alter table audit_events add constraint audit_events_entity_check
  check (entity in ('company', 'contact', 'task', 'activity',
                    'deletion_request', 'member', 'data', 'template', 'setting',
                    'attachment', 'location'));

-- Coordinates and the derived area are the geocoder's business, not the
-- feed's: a batch run would otherwise write a line per company.
create or replace function audit_ignored_column(col text)
returns boolean
language sql
immutable
as $$
  select col in ('updated_at', 'last_touch_at', 'tier_rank', 'area', 'geo_precision',
                 'archived_at', 'latitude', 'longitude',
                 'location_regions', 'location_cities');
$$;

create or replace function audit_location()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  changed text[];
  place text;
begin
  if tg_op = 'DELETE' then
    if audit_parent_gone(old.company_id) then return old; end if;
    perform audit_log('location', 'deleted', old.id, old.company_id,
                      format('Removed the location %s',
                             coalesce(old.label, old.city, old.address, 'without a name')),
                      null);
    return old;
  end if;

  place := coalesce(new.label, new.city, new.address, 'a location');

  if tg_op = 'INSERT' then
    perform audit_log('location', 'created', new.id, new.company_id,
                      format('Added the location %s', place),
                      jsonb_build_object('primary', new.is_primary));
    return new;
  end if;

  changed := audit_changed_fields(to_jsonb(old), to_jsonb(new));
  if array_length(changed, 1) is null then return new; end if;

  perform audit_log('location', 'updated', new.id, new.company_id,
                    format('Edited %s (%s)', place, array_to_string(changed, ', ')),
                    jsonb_build_object('fields', changed));
  return new;
end;
$$;

revoke execute on function audit_location() from anon, authenticated, public;

drop trigger if exists company_locations_audit on company_locations;
create trigger company_locations_audit
  after insert or update or delete on company_locations
  for each row execute function audit_location();

-- ============================================================== 6. drop

-- The search index names `city`, so it has to go before the column does. The
-- replacement drops city from the vector: a company's cities live on its
-- locations now, and the palette searches those directly.
drop index if exists companies_search;
drop index if exists companies_area_idx;

create index if not exists companies_search on companies
  using gin (to_tsvector('english',
    name || ' ' || coalesce(industry, '') || ' ' || coalesce(notes, '')
         || ' ' || coalesce(type, '')));

alter table companies drop column if exists address;
alter table companies drop column if exists city;
alter table companies drop column if exists region;
alter table companies drop column if exists county;
alter table companies drop column if exists area;
alter table companies drop column if exists latitude;
alter table companies drop column if exists longitude;
alter table companies drop column if exists geo_precision;
