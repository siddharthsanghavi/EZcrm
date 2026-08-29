-- A third role: viewer. Reads everything, writes nothing.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
-- WHY THIS EXISTS
--
-- The club has people who need to see the pipeline without being trusted to
-- change it -- a treasurer checking committed sponsors, a teacher supervising a
-- tour, an incoming committee member during handover. Until now the only way to
-- show someone the data was to make them a member, which is also permission to
-- retier 1,200 companies and delete their own records.
--
-- HOW IT WORKS
--
-- `is_member()` used to mean "has a profile", and every policy -- read and write
-- alike -- was built on it. It now means "has a profile AND may write", and a
-- new `has_access()` means "has a profile at all". Read policies move to
-- has_access(); write policies keep is_member() and therefore exclude viewers
-- automatically. The security property to hold on to: a viewer is refused by the
-- database, not merely by a hidden button.

-- ------------------------------------------------------------------ the role

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('viewer', 'member', 'admin'));

-- Which role a newly allowlisted address gets when they first sign in. Defaults
-- to member, so every existing row keeps today's behaviour.
alter table allowed_emails add column if not exists role text not null default 'member'
  check (role in ('viewer', 'member', 'admin'));

create or replace function has_access()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;

-- Note the changed meaning. Anything still calling is_member() is asking "may
-- this person write?", which is what every remaining caller means.
create or replace function is_member()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('member', 'admin'));
$$;

-- Same reasoning as the original grant: policy evaluation runs as the querying
-- role, so without EXECUTE every viewer query fails with "permission denied for
-- function has_access" instead of returning their rows.
grant execute on function has_access() to anon, authenticated;

-- ------------------------------------------------------------ read policies

-- Every table a signed-in person may read. The write policies are deliberately
-- left alone: they call is_member(), which no longer matches a viewer.
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

drop policy if exists audit_events_read on audit_events;
create policy audit_events_read on audit_events for select using (has_access());

drop policy if exists company_deletions_read on company_deletions;
create policy company_deletions_read on company_deletions for select using (has_access());

drop policy if exists deletion_requests_read on deletion_requests;
create policy deletion_requests_read on deletion_requests for select using (has_access());

-- Saved views are shared or private, and that distinction is about people, not
-- about write access -- so a viewer sees exactly what a member sees.
drop policy if exists saved_views_read on saved_views;
create policy saved_views_read on saved_views
  for select using (has_access() and (shared or owner_id = auth.uid()));

-- ---------------------------------------------------------- managing viewers

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

-- The allowlist decides what someone becomes on first sign-in. Without this an
-- invited viewer would arrive as a member, which is the whole thing we are
-- trying to avoid, and nobody would notice until they changed something.
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
