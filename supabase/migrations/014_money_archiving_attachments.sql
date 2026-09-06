-- Money, archiving, handoff, attachments, and a stage gate.
-- Safe to re-run; mirrored into supabase/schema.sql for fresh projects.
--
-- Five roadmap items that all needed schema, so they arrive together rather
-- than as five files applied in an order somebody has to get right.
--
--   1. money        -- companies.amount and close_date, for a weighted funnel
--   2. archiving    -- companies.archived_at, and moving a leaver's work
--   3. stage gate   -- "committed" has to mean something
--   4. attachments  -- the signed agreement, kept where the club can find it
--   5. audit        -- the new vocabulary those need

-- ============================================================ 1. money

-- On companies, not a `deals` table. A club pursues one relationship per
-- company; concurrent deals is a shape this does not have, and modelling it
-- would cost every query a join for nothing.
alter table companies add column if not exists amount numeric(12,2);
alter table companies add column if not exists close_date date;

create index if not exists companies_amount_idx on companies (amount desc nulls last);

-- ========================================================= 2. archiving

-- Archiving is not deleting: the row, its history and its contacts all stay,
-- and an archived company can be brought back. It exists because a successor
-- inheriting 1,200 rows needs to know which ones are live.
alter table companies add column if not exists archived_at timestamptz;

create index if not exists companies_archived_idx on companies (archived_at);

/**
 * Move one member's work to another, in one statement.
 *
 * Removing somebody without moving their companies is the mistake this exists
 * to prevent: their rows keep an owner_id that no longer resolves to anyone,
 * and nobody notices until a going-cold list is quietly wrong. Admin-only, and
 * checked here rather than trusted from the caller, because it rewrites other
 * people's assignments.
 */
create or replace function reassign_member(from_member uuid, to_member uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  moved_companies int;
  moved_tasks int;
begin
  if not is_admin() then
    raise exception 'Only admins can reassign work';
  end if;
  if from_member is null then
    raise exception 'Nobody to reassign from';
  end if;
  if from_member = to_member then
    raise exception 'That is the same person';
  end if;
  -- to_member may be null: "unassign everything" is a legitimate handoff when
  -- the work is going back into the pool rather than to a named successor.
  if to_member is not null and not exists (select 1 from profiles where id = to_member) then
    raise exception 'That member does not exist';
  end if;

  update companies set owner_id = to_member where owner_id = from_member;
  get diagnostics moved_companies = row_count;

  update tasks set assignee_id = to_member where assignee_id = from_member and not done;
  get diagnostics moved_tasks = row_count;

  return jsonb_build_object('companies', moved_companies, 'tasks', moved_tasks);
end;
$$;

revoke execute on function reassign_member(uuid, uuid) from anon, public;
grant execute on function reassign_member(uuid, uuid) to authenticated;

-- ======================================================== 3. stage gate

/**
 * "Committed" has to mean something.
 *
 * A company cannot reach committed without a named contact and a date, because
 * the pipeline chart is read as a promise about the season and a committed row
 * with nobody's name on it is how that promise quietly becomes false.
 *
 * Deliberately only this one transition. Gating every stage would turn a
 * two-second status change into a form, which is how people stop updating
 * statuses at all.
 */
create or replace function check_committed_ready()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.status = 'committed' and (tg_op = 'INSERT' or old.status is distinct from 'committed') then
    if new.close_date is null then
      raise exception 'Set the date before marking % committed', new.name
        using hint = 'A committed company needs a date in Edit → Close date.';
    end if;
    if not exists (select 1 from contacts where company_id = new.id) then
      raise exception 'Add a contact before marking % committed', new.name
        using hint = 'Somebody at the company has to be the person who said yes.';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function check_committed_ready() from anon, authenticated, public;

drop trigger if exists companies_committed_gate on companies;
create trigger companies_committed_gate
  before insert or update of status on companies
  for each row execute function check_committed_ready();

-- ======================================================= 4. attachments

-- The index; the files themselves live in Storage. A club's signed agreements
-- currently live in one member's Drive and leave with them when they graduate.
create table if not exists attachments (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references companies on delete cascade,
  name        text not null,
  -- Path inside the private bucket. Never guessable, never public: reads go
  -- through a short-lived signed URL minted for a member.
  path        text not null unique,
  mime        text,
  size_bytes  bigint,
  created_by  uuid references profiles on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists attachments_company_idx on attachments (company_id, created_at desc);

alter table attachments enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='attachments' and policyname='attachments_read') then
    create policy attachments_read on attachments for select using (has_access());
  end if;
  if not exists (select 1 from pg_policies where tablename='attachments' and policyname='attachments_insert') then
    create policy attachments_insert on attachments for insert with check (is_member());
  end if;
  if not exists (select 1 from pg_policies where tablename='attachments' and policyname='attachments_delete') then
    create policy attachments_delete on attachments for delete using (is_admin() or created_by = auth.uid());
  end if;
end $$;

-- The bucket. Private, and it must stay private: a public bucket makes every
-- signed agreement readable by anyone who can guess a path.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do nothing;

-- Storage policies live on storage.objects, so every clause needs
-- `bucket_id = 'attachments'` or it leaks across buckets. The pg_policies guard
-- needs schemaname = 'storage' for the same reason.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname='storage' and tablename='objects' and policyname='attachments_read') then
    create policy attachments_read on storage.objects
      for select using (bucket_id = 'attachments' and has_access());
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname='storage' and tablename='objects' and policyname='attachments_write') then
    create policy attachments_write on storage.objects
      for insert with check (bucket_id = 'attachments' and is_member());
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname='storage' and tablename='objects' and policyname='attachments_remove') then
    create policy attachments_remove on storage.objects
      for delete using (bucket_id = 'attachments' and is_member());
  end if;
end $$;

-- ============================================================ 5. audit

alter table audit_events drop constraint if exists audit_events_entity_check;
alter table audit_events add constraint audit_events_entity_check
  check (entity in ('company', 'contact', 'task', 'activity',
                    'deletion_request', 'member', 'data', 'template', 'setting',
                    'attachment'));

alter table audit_events drop constraint if exists audit_events_action_check;
alter table audit_events add constraint audit_events_action_check
  check (action in ('created', 'updated', 'deleted', 'status_changed', 'assigned',
                    'tier_changed', 'completed', 'reopened', 'requested', 'declined',
                    'withdrawn', 'invited', 'removed', 'role_changed', 'renamed',
                    'imported', 'exported', 'archived', 'restored', 'uploaded'));

create or replace function audit_attachment()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if audit_parent_gone(old.company_id) then return old; end if;
    perform audit_log('attachment', 'deleted', old.id, old.company_id,
                      format('Deleted the file %s', old.name), null);
    return old;
  end if;

  perform audit_log('attachment', 'uploaded', new.id, new.company_id,
                    format('Uploaded %s', new.name),
                    jsonb_build_object('bytes', new.size_bytes));
  return new;
end;
$$;

revoke execute on function audit_attachment() from anon, authenticated, public;

drop trigger if exists attachments_audit on attachments;
create trigger attachments_audit
  after insert or delete on attachments
  for each row execute function audit_attachment();

-- Archiving is a status-shaped act, so it reads as its own line in the feed
-- rather than as "Edited X (archived_at)".
create or replace function audit_company_archive()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.archived_at is distinct from old.archived_at then
    perform audit_log('company',
                      case when new.archived_at is null then 'restored' else 'archived' end,
                      new.id, new.id,
                      format('%s %s', case when new.archived_at is null then 'Restored' else 'Archived' end, new.name),
                      null);
  end if;
  return new;
end;
$$;

revoke execute on function audit_company_archive() from anon, authenticated, public;

drop trigger if exists companies_archive_audit on companies;
create trigger companies_archive_audit
  after update of archived_at on companies
  for each row execute function audit_company_archive();

-- `archived_at` is machine-ish bookkeeping as far as the generic edit event is
-- concerned: without this, archiving something also logs "Edited X (archived_at)".
create or replace function audit_ignored_column(col text)
returns boolean
language sql
immutable
as $$
  select col in ('updated_at', 'last_touch_at', 'tier_rank', 'area', 'geo_precision', 'archived_at');
$$;
