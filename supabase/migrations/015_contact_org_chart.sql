-- Who reports to whom, and which division they sit in.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
-- WHY THIS EXISTS
--
-- A company with six contacts is currently six equal names in a list. In
-- reality one of them runs the site, two report to her, and three are in a
-- different division entirely -- and that shape is the whole reason you know
-- who to ask when the first person goes quiet. Without it, "we have a contact
-- there" is a much weaker claim than it looks.
--
-- Two fields carry it. `reports_to` is a self-reference on contacts, which
-- makes an org chart. `division` is free text, because a club cannot know in
-- advance whether a company is split into Operations and Marketing, or into
-- North Plant and South Plant, and a fixed list would be wrong at the first
-- company that does it differently.
--
-- WHAT THE DATABASE ENFORCES
--
-- Two ways a reporting line can be nonsense, both refused here rather than in
-- the UI, because either one turns the tree render into an infinite loop:
--
--   * reporting to someone at a different company
--   * a cycle -- A reports to B reports to C reports to A, which is easy to
--     create in two innocent edits by two different people
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

-- ------------------------------------------------------------------- the feed
--
-- Replaces 013's audit_contact(). "Edited contact Priya Nair (reports_to)" is
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
