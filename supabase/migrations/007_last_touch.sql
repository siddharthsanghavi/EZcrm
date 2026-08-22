-- Going-cold detection.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
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

-- Maintained by trigger rather than application code, so an activity logged
-- from anywhere -- the UI, an import, raw SQL -- counts as a touch.
--
-- Guarded by the where clause as well as greatest(): back-dating an old call
-- must not pull a company's last touch backwards.
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

-- Backfill from whatever is already logged.
update companies c
   set last_touch_at = a.latest
  from (select company_id, max(occurred_at) as latest
          from activities where company_id is not null group by company_id) a
 where a.company_id = c.id
   and c.last_touch_at is distinct from a.latest;

update contacts p
   set last_touch_at = a.latest
  from (select contact_id, max(occurred_at) as latest
          from activities where contact_id is not null group by contact_id) a
 where a.contact_id = p.id
   and p.last_touch_at is distinct from a.latest;
