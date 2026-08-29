-- Widen the activity feed: membership changes, and imports and exports.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
-- WHAT WAS MISSING
--
-- 013 covered everything that happens to the records themselves -- companies,
-- contacts, tasks, outreach, deletion requests. Two kinds of action were still
-- invisible.
--
-- Membership. Inviting someone, removing them, or making them an admin changes
-- who can do what to the club's data, which makes it the most consequential
-- thing anyone does here and the least visible. login_events records sign-ins
-- but nothing recorded the granting.
--
-- Imports and exports. An import writes hundreds of rows at once; an export
-- takes a copy of the whole database out of the building. The import at least
-- left a trail of per-row "Added X" events, though nothing said they were one
-- act. The export left nothing at all -- it is a read, so no trigger can see
-- it, and it is the single action most worth being able to point at later.
--
-- Sign-ins are still deliberately absent. login_events covers them.

-- ------------------------------------------------------- widen the vocabulary

alter table audit_events drop constraint if exists audit_events_entity_check;
alter table audit_events add constraint audit_events_entity_check
  check (entity in ('company', 'contact', 'task', 'activity', 'deletion_request',
                    'member', 'data'));

alter table audit_events drop constraint if exists audit_events_action_check;
alter table audit_events add constraint audit_events_action_check
  check (action in ('created', 'updated', 'deleted', 'status_changed', 'assigned',
                    'tier_changed', 'completed', 'reopened', 'requested', 'declined',
                    'withdrawn', 'invited', 'removed', 'role_changed', 'renamed',
                    'imported', 'exported'));

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
