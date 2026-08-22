-- Map grouping + per-company pin precision.

-- Whether a pin is a real street location or just the town centre, so the map
-- can be honest about precision rather than implying accuracy it doesn't have.
alter table companies add column if not exists geo_precision text
  check (geo_precision in ('address', 'city'));
update companies set geo_precision = 'city' where latitude is not null and geo_precision is null;
create index if not exists companies_geo_precision_idx on companies (geo_precision);

alter table companies add column if not exists county text;
create index if not exists companies_county_idx on companies (county);
alter table geocache  add column if not exists county text;

-- An imported `region` column is often unusable for mapping — in one real import
-- a quarter of the rows held industry tags rather than places, and the rest were
-- inconsistent free text. Deriving an area from coordinates instead gives a small,
-- stable set of groups for the map to cluster by.
--
-- REPLACE THE ANCHORS BELOW for your own geography: one row per region you want,
-- with a representative latitude and longitude. Each company is assigned to the
-- nearest one.
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

revoke execute on function ez_area(double precision, double precision) from anon, authenticated, public;

update companies set area = ez_area(latitude, longitude) where latitude is not null;
