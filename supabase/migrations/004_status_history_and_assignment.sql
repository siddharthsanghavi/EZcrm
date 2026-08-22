-- Status history + member assignment.
-- Safe to re-run; included in schema.sql for fresh projects.

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
