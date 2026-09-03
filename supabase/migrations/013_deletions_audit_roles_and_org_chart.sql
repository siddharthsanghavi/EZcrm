-- Deletion tracking, an activity feed, a read-only role, and the contact tree.
-- Safe to re-run; mirrored into supabase/schema.sql for fresh projects.
--
-- One file, because these are one idea -- the app should record what people do,
-- and not everyone should be able to do all of it -- and because they touch the
-- same objects. Applied as three files, `audit_contact()` was written twice and
-- the `audit_events` vocabulary was altered five times; whoever ran them out of
-- order silently kept the earlier definition. Here every object is created once,
-- in its final form, in an order where nothing refers to something that does not
-- exist yet:
--
--   1. roles          -- has_access(), is_member(), and what an invitation grants
--   2. read policies  -- every existing table moves to has_access()
--   3. deletions      -- the log, the request queue, admin-only deletes
--   4. org chart      -- contacts.reports_to and contacts.division
--   5. activity       -- audit_events and every trigger that fills it
--   6. settings       -- club details and the editable email templates
--
-- WHY EACH PART EXISTS
--
-- Deletions. Deleting a company takes its contacts, activity and tasks with it
-- and there is no undo. Any member could do that to anything they had added, and
-- nothing recorded it: a company simply stopped existing, and nobody could tell
-- whether it had been deleted or never entered.
--
-- Roles. The club has people who need to see the pipeline without being trusted
-- to change it -- a treasurer, a supervising teacher, an incoming committee
-- member mid-handover. The only way to show them the data was to make them a
-- member, which is also permission to retier 1,200 companies.
--
-- Settings. The club's own details and its standard letters were code and
-- browser storage: fine while nobody needed to change them, wrong the moment
-- the committee wanted to edit a letter without a developer. Both are shared
-- by the whole club, so both belong where everyone sees the same thing.
--
-- Org chart. Six contacts at a company were six equal names in a list. In
-- reality one runs the site, two report to her, and three are in another
-- division -- and that shape is how you know who to ask when the first one goes
-- quiet.
--
-- Activity. "Activity" used to mean one thing: outreach somebody typed into the
-- composer. Everything else left either a specialised trace nobody reads
-- (status_events) or none at all, so "what happened this week?" had no answer.
--
-- WHAT THIS DOES NOT REPLACE
--
-- status_events still records status moves, because the pipeline chart counts
-- transitions from it. The overlap with audit_events is a few hundred rows a
-- year and is worth it: one is narrow and structured, the other wide and
-- readable.
--
-- Sign-ins are deliberately absent from audit_events. login_events covers them,
-- it is admin-only because it holds addresses of people who are not members, and
-- a feed of "Ada signed in" forty times a week would bury everything else.

-- =========================================================== 1. roles
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('viewer', 'member', 'admin'));

-- Which role a newly allowlisted address gets on first sign-in. Defaults to
-- member, so every existing row keeps today's behaviour.
alter table allowed_emails add column if not exists role text not null default 'member'
  check (role in ('viewer', 'member', 'admin'));

-- "Has a profile at all." Every read policy below is built on this.
create or replace function has_access()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;

-- Note the changed meaning: is_member() used to be "has a profile" and is now
-- "has a profile AND may write". Every remaining caller is a write policy, and
-- that is exactly the question a write policy is asking -- which is why viewers
-- are refused by the database rather than merely by a hidden button.
create or replace function is_member()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('member', 'admin'));
$$;

-- Same reasoning as the original grants on is_member()/is_admin(): policy
-- evaluation runs as the querying role, so without EXECUTE every viewer query
-- fails with "permission denied for function has_access" instead of returning
-- their rows.
grant execute on function has_access() to anon, authenticated;

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

-- The allowlist decides what someone becomes when they first sign in. Without
-- this an invited viewer would arrive as a member -- the whole thing we are
-- trying to avoid -- and nobody would notice until they changed something.
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

-- =================================================== 2. read policies

-- Everything a signed-in person may read. Write policies are left alone: they
-- call is_member(), which no longer matches a viewer.
do $$
declare t text;
begin
  foreach t in array array['companies', 'contacts', 'activities', 'tasks'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select using (has_access())', t);
  end loop;
end;
$$;

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (has_access());

drop policy if exists status_events_read on status_events;
create policy status_events_read on status_events for select using (has_access());

-- Shared or private is about people, not about write access, so a viewer sees
-- exactly what a member sees.
drop policy if exists saved_views_read on saved_views;
create policy saved_views_read on saved_views
  for select using (has_access() and (shared or owner_id = auth.uid()));

-- ================================================ 3. deleting companies

-- Was: is_admin() or created_by = auth.uid(). A member deleting the company
-- they added is the case the request queue below replaces, so this narrows to
-- admins. Contacts, activities and tasks keep their own delete policy -- this
-- is about companies, which take everything else with them.
drop policy if exists companies_delete on companies;
create policy companies_delete on companies for delete using (is_admin());

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

-- The club's own details, merged into every outgoing draft. Seeded with visible
-- placeholders on purpose: a draft that says [YOUR CLUB] is obviously
-- unfinished, whereas one that says "the Engineering Society" is wrong in a way
-- somebody will send by accident.
insert into settings (key, value)
values ('club', jsonb_build_object(
  'clubName', '[YOUR CLUB]',
  'school', '[YOUR SCHOOL]',
  'groupSize', '[GROUP SIZE]',
  'visitLength', '[LENGTH]'
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

-- The four letters the club actually sends, as a starting point. Editing them is
-- the whole point of putting them in a table, so a re-run never overwrites what
-- somebody has since changed.
insert into email_templates (slug, name, guidance, subject, body, sort, suggest_for)
values
  ('tour', 'Ask for a tour', 'First approach, when you want to visit.',
   'Student visit to {{company}}?', E'{{greeting}}\n\nI am {{my_name}}, from {{club}} at {{school}}. We take small groups of students to see how things are actually made and run, because a morning on a real site teaches more than a term of slides.\n\nI am writing to ask whether {{company}} would consider hosting us at {{site}}. We are interested in your work in {{what_they_do}}.\n\nWhat we would ask for:\n\n- About {{group_size}} students, plus one member of staff\n- Roughly {{visit_length}}, on a weekday that suits you\n- Any date in term time — we work around your calendar, not the other way round\n\nWhat we bring: students who have been briefed on site rules, sensible shoes, and questions prepared in advance. We are happy to sign whatever visitor agreement or NDA you use, and to keep phones away entirely if you would prefer.\n\nWould you be open to it? I am glad to answer any questions first.\n\nThank you for your time,\n{{signature}}', 10, 'prospect'),
  ('sponsorship', 'Ask for sponsorship', 'First approach, when you want support.',
   '{{club}} at {{school}} — supporting {{group_size}} students', E'{{greeting}}\n\nI am {{my_name}}, writing on behalf of {{club}} at {{school}}. We are a student group of about {{group_size}}, and we spend the year visiting employers and running events for members who are about to enter the industry.\n\nWe are looking for organisations to support that programme. Support can be a contribution towards travel and materials, or something in kind — hosting an event, sending a speaker, covering a coach. We are glad to acknowledge supporters on our materials and at our events, and equally glad not to if you would rather stay quiet about it.\n\nI am contacting {{company}} because of your work in {{what_they_do}}.\n\nCould I send you a short outline of what we do and what support would mean this year?\n\nThank you for reading,\n{{signature}}', 20, null),
  ('nudge', 'Nudge after silence', 'You wrote, nobody replied, it has been a fortnight.',
   'Following up: visiting {{company}}', E'{{greeting}}\n\nI wrote a couple of weeks ago about bringing a group of students from {{club}} at {{school}} to {{site}}, and I know a message like mine is easy to lose.\n\nIf a visit is not something you can host, please just say so and I will stop writing — no hard feelings at all, and it is genuinely useful to know.\n\nIf it is a matter of timing, we are flexible: any term-time month works, and we can fit around a quiet week in your calendar.\n\nThanks either way,\n{{signature}}', 30, 'contacted'),
  ('reintro', 'New year, new committee', 'They hosted before, and the committee has changed.',
   '{{club}} — new committee, saying hello again', E'{{greeting}}\n\n{{company}} has worked with {{club}} at {{school}} before, and I wanted to reintroduce us: the committee changes every year, and I am this year''s.\n\nWe are planning our visits for the coming year, and yours is on the list of places our members ask about. If you are still open to hosting a group of around {{group_size}} for {{visit_length}}, I would love to find a date. If circumstances have changed, that is completely understood — just let me know and I will take you off our list.\n\nBest wishes,\n{{signature}}', 40, 'dormant')
on conflict (slug) do nothing;
