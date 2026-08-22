-- Saved views.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
-- A filter combination someone worked out ("Tier 1, unassigned, going cold") is
-- worth keeping. Stored as the querystring rather than as columns, so a view
-- needs no schema of its own and stays a plain link anyone can paste in chat.
-- The cost is that a renamed filter param orphans old views; at this size that
-- is a better trade than a query builder.

create table if not exists saved_views (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  path       text not null default '/companies',
  query      text not null default '',
  -- The club shares one workspace, so a saved view is shared by default.
  -- Unticking it makes a private working list.
  shared     boolean not null default true,
  owner_id   uuid references profiles on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists saved_views_owner_idx on saved_views (owner_id);

alter table saved_views enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='saved_views' and policyname='saved_views_read') then
    create policy saved_views_read on saved_views
      for select using (is_member() and (shared or owner_id = auth.uid()));
  end if;

  -- owner_id must be the caller: without this a member could file a view under
  -- someone else's name, and the owner-only update policy would then lock the
  -- real author out of their own row.
  if not exists (select 1 from pg_policies where tablename='saved_views' and policyname='saved_views_insert') then
    create policy saved_views_insert on saved_views
      for insert with check (is_member() and owner_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where tablename='saved_views' and policyname='saved_views_update') then
    create policy saved_views_update on saved_views
      for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where tablename='saved_views' and policyname='saved_views_delete') then
    create policy saved_views_delete on saved_views
      for delete using (is_admin() or owner_id = auth.uid());
  end if;
end $$;
