-- Only needed if you already ran schema.sql before the directory import.
-- On a fresh project, schema.sql already includes these columns and this is a no-op.

alter table companies add column if not exists type      text;
alter table companies add column if not exists tier      text;
alter table companies add column if not exists city      text;
alter table companies add column if not exists region    text;
alter table companies add column if not exists address   text;
alter table companies add column if not exists phone     text;
alter table companies add column if not exists employees integer;

-- Alphabetical sorting on `tier` would rank "Reference" above "Tier 1".
alter table companies add column if not exists tier_rank integer
  generated always as (
    case tier
      when 'Tier 1' then 1
      when 'Tier 2' then 2
      when 'Tier 3' then 3
      when 'Reference' then 4
      else 5
    end) stored;

create index if not exists companies_tier_idx   on companies (tier_rank, name);
create index if not exists companies_type_idx   on companies (type);
create index if not exists companies_region_idx on companies (region);

drop index if exists companies_search;
create index companies_search on companies
  using gin (to_tsvector('english',
    name || ' ' || coalesce(industry, '') || ' ' || coalesce(notes, '') || ' '
         || coalesce(city, '') || ' ' || coalesce(type, '')));
