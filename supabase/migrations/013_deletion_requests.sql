-- Company deletions: an audit trail, and a request/approve path for members.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
-- WHY THIS EXISTS
--
-- Deleting a company takes its contacts, activity and tasks with it, and there
-- is no undo. Until now any member could do that to anything they had added,
-- and nothing recorded that it happened -- a company simply stopped existing,
-- and nobody could tell whether it had been deleted or had never been entered.
--
-- Two changes here. Deletions are now written to `company_deletions` by a
-- trigger, so the record survives the row it describes. And the delete policy
-- on companies narrows to admins: everyone else files a request, which an admin
-- approves (the delete happens then) or declines.

-- ------------------------------------------------------------------ audit log

-- Deliberately NO foreign key to companies: the whole point is to outlive the
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
    create policy company_deletions_read on company_deletions for select using (is_member());
  end if;
end $$;

-- No insert/update/delete policy at all: rows arrive only through the trigger
-- below, which is security definer. An append-only log nobody can edit.

-- ------------------------------------------------------------------- requests

create table if not exists deletion_requests (
  id           uuid primary key default uuid_generate_v4(),
  -- Cascades: an approved request's company is gone, and so is the request.
  -- What happened is recorded in company_deletions, which does not cascade.
  company_id   uuid not null references companies on delete cascade,
  requested_by uuid references profiles on delete set null,
  requested_at timestamptz not null default now(),
  reason       text,
  status       text not null default 'pending'
                 check (status in ('pending', 'declined', 'withdrawn')),
  decided_by   uuid references profiles on delete set null,
  decided_at   timestamptz,
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
    create policy deletion_requests_read on deletion_requests for select using (is_member());
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

-- ------------------------------------------------------- recording a deletion

-- A trigger rather than application code, for the same reason status changes
-- are: it fires wherever the delete comes from -- the UI, the SQL editor, a
-- cascade -- and cannot be forgotten at a call site.
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

-- ------------------------------------------------------------ admin decisions

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

-- ------------------------------------------------------ narrow the delete path

-- Was: is_admin() or created_by = auth.uid(). A member deleting the company they
-- added is exactly the case this feature replaces with a request, so the policy
-- narrows to admins. Contacts, activities and tasks keep their own delete
-- policy -- this is about companies, which take everything else with them.
drop policy if exists companies_delete on companies;
create policy companies_delete on companies for delete using (is_admin());
