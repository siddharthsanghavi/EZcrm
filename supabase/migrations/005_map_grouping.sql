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

-- The existing `region` column is unusable for mapping: ~300 rows hold industry
-- tags ("GA / Rubber & Plastics") rather than places, and the rest are 155
-- inconsistent variants. Derive a clean area from coordinates instead, by
-- assigning each company to the nearest of a fixed set of anchors.
alter table companies add column if not exists area text;
create index if not exists companies_area_idx on companies (area);

create or replace function ez_area(lat double precision, lon double precision)
returns text
language sql
immutable
as $$
  select a.name
  from (values
    ('Metro Atlanta',            33.7550, -84.3900),
    ('Northwest Georgia',        34.6000, -85.0000),
    ('Northeast Georgia',        34.3500, -83.5500),
    ('Athens Area',              33.9600, -83.3800),
    ('Augusta / CSRA',           33.4700, -82.0000),
    ('Columbus / West Georgia',  32.4600, -84.9900),
    ('Middle Georgia',           32.8400, -83.6300),
    ('Southwest Georgia',        31.5800, -84.1600),
    ('South Georgia',            30.8300, -83.2800),
    ('Southeast Georgia',        31.5000, -82.3000),
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
