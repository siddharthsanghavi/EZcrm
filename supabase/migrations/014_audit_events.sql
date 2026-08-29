-- One feed of everything that happens to the data.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
-- WHY THIS EXISTS
--
-- Until now "activity" meant one thing: outreach somebody typed into the
-- composer. Everything else the club did to the database -- adding a company,
-- finishing a task, adding a contact, retiring a record -- left either a
-- specialised trace nobody looks at (status_events, company_deletions) or no
-- trace at all. So "what happened this week?" had no answer, and a company that
-- quietly changed hands looked identical to one nobody had touched.
--
-- audit_events is that answer: every write, one row, one readable sentence.
--
-- Sign-ins are deliberately NOT here. login_events covers them, it is admin-only
-- because it holds email addresses of people who are not members, and a feed of
-- "Ada signed in" 40 times a week would bury the things worth reading.
--
-- WHAT THIS DOES NOT REPLACE
--
-- status_events still records status moves, because the pipeline chart counts
-- transitions from it, and company_deletions still holds the row snapshot
-- needed to retype a deletion. Both are narrow and structured; this is wide and
-- readable. The overlap is a few hundred rows a year and is worth it.

create table if not exists audit_events (
  id         uuid primary key default uuid_generate_v4(),
  -- clock_timestamp(), not now(): several events can share a transaction (a
  -- bulk assign, a cascade) and now() would give them all one timestamp and an
  -- arbitrary order.
  at         timestamptz not null default clock_timestamp(),
  -- Null when nobody was signed in -- the geocode function, a SQL editor
  -- session, a cascade. The UI says "automatically" rather than inventing a name.
  actor      uuid references profiles on delete set null,
  entity     text not null check (entity in ('company', 'contact', 'task', 'activity', 'deletion_request')),
  action     text not null check (action in (
               'created', 'updated', 'deleted', 'status_changed', 'assigned',
               'tier_changed', 'completed', 'reopened', 'requested', 'declined', 'withdrawn')),
  entity_id  uuid,
  -- No foreign key, for the same reason company_deletions has none: an event
  -- about a deleted company has to outlive the company.
  company_id uuid,
  summary    text not null,
  details    jsonb
);

create index if not exists audit_events_recent_idx  on audit_events (at desc);
create index if not exists audit_events_company_idx on audit_events (company_id, at desc);
create index if not exists audit_events_actor_idx   on audit_events (actor, at desc);

alter table audit_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename='audit_events' and policyname='audit_events_read') then
    create policy audit_events_read on audit_events for select using (is_member());
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

-- Which real fields changed, as a text[] -- for the "updated (city, phone)" tail
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

-- ------------------------------------------------------------------ companies

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
    -- people scan a feed for, and "updated" would hide them among the rest.
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

-- --------------------------------------------------------- children of a company
--
-- A company delete cascades to its contacts, activities and tasks. Auditing each
-- of those would turn one deliberate act into thirty lines of feed, all saying
-- something the "Deleted X" line above already said. So the child triggers stay
-- quiet when their company has just gone: inside the cascade the parent row is
-- already deleted, which is exactly what this checks.
create or replace function audit_parent_gone(p_company_id uuid)
returns boolean
language sql
security definer set search_path = public, pg_temp
stable
as $$
  select p_company_id is not null and not exists (select 1 from companies where id = p_company_id);
$$;

revoke execute on function audit_parent_gone(uuid) from anon, authenticated, public;

create or replace function audit_contact()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  who text;
  changed text[];
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
                      jsonb_build_object('title', new.title));
  else
    changed := audit_changed_fields(to_jsonb(old), to_jsonb(new));
    if array_length(changed, 1) > 0 then
      perform audit_log('contact', 'updated', new.id, new.company_id,
                        format('Edited contact %s (%s)', who, array_to_string(changed, ', ')),
                        jsonb_build_object('fields', changed));
    end if;
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

-- ----------------------------------------------------------- deletion requests

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
