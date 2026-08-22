-- PRIVILEGE ESCALATION FIX.
--
-- profiles_self_update lets a member update their own row, and RLS has no
-- per-column granularity — so "update your display name" also meant
-- "set role = 'admin'". Verified exploitable before this fix: a member
-- promoted themselves in one statement.
--
-- Column privileges are the right tool. `authenticated` may write full_name and
-- nothing else; role changes go through a SECURITY DEFINER function that checks
-- the caller is an admin.

revoke update on public.profiles from authenticated;
grant  update (full_name) on public.profiles to authenticated;

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
  if new_role not in ('member', 'admin') then
    raise exception 'Invalid role';
  end if;

  -- Never leave the club without an admin.
  if new_role = 'member' then
    select count(*) into admins from profiles where role = 'admin';
    if admins <= 1 and (select role from profiles where id = target) = 'admin' then
      raise exception 'Cannot remove the last admin';
    end if;
  end if;

  update profiles set role = new_role where id = target;
end;
$$;

grant execute on function set_member_role(uuid, text) to authenticated;
