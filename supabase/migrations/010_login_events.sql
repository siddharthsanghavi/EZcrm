-- Login tracking.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
-- WHY THIS EXISTS
--
-- Supabase does keep an auth audit log at `auth.audit_log_entries`, but it is
-- pruned and on this project it is empty, so it cannot be built on. `auth.users`
-- and `auth.sessions` are not readable by `authenticated` either, and there is
-- no service-role key in this app by design. So the app records its own.
--
-- The distinction from 009 matters: `auth_email_requests` counts links ASKED
-- for; this counts sessions actually STARTED. The gap between them is the
-- interesting number. A member who requests three links and never appears here
-- is hitting the "opened in a different browser" problem that /login already
-- has a paragraph of apology for -- and until now, nothing measured how often
-- that actually happened.

create table if not exists login_events (
  id         uuid primary key default uuid_generate_v4(),
  profile_id uuid references profiles on delete set null,
  email      text,
  -- signed_in: a session was created and the user is a club member.
  -- denied:    authenticated fine, but no profile -- i.e. not on the allowlist.
  --            This is the allowlist doing its job, and worth seeing.
  -- failed:    the link itself didn't work. Usually the PKCE verifier is missing
  --            because the link was opened somewhere else.
  -- signed_out: explicit sign-out.
  event      text not null check (event in ('signed_in', 'denied', 'failed', 'signed_out')),
  -- Which flow was used, so you can tell whether moving the email template to
  -- /auth/confirm actually reduced the failures.
  method     text check (method in ('pkce', 'token_hash', 'implicit', 'unknown')),
  reason     text,
  ip_hash    text,
  created_at timestamptz not null default now()
);

create index if not exists login_events_recent_idx  on login_events (created_at desc);
create index if not exists login_events_profile_idx on login_events (profile_id, created_at desc);

alter table login_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename='login_events' and policyname='login_events_admin_read') then
    create policy login_events_admin_read on login_events
      for select using (is_admin());
  end if;
end $$;

-- Same reasoning as auth_email_requests: this holds email addresses and the
-- write path has to be reachable before a session exists, so anon gets no
-- direct access at all and goes through the function below.
revoke all on public.login_events from anon;

-- ------------------------------------------------------------------ recording
--
-- Callable by anon because a failed sign-in has no session by definition.
-- Resolves the profile from auth.uid() when there is one, so the caller cannot
-- claim to be somebody else -- the email argument is only used for the failure
-- case, where nothing is authenticated yet and it is all we have.
create or replace function record_login_event(
  p_event   text,
  p_method  text default 'unknown',
  p_email   text default null,
  p_reason  text default null,
  p_ip_hash text default null
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  -- Ceiling on rows per hour: this is an unauthenticated write path, so it must
  -- not be able to grow the table without bound on a 500MB free tier.
  insert_ceiling constant int := 500;
  v_uid uuid := auth.uid();
  v_rows_this_hour int;
begin
  if p_event not in ('signed_in', 'denied', 'failed', 'signed_out') then
    return;  -- never raise: tracking must not be able to break sign-in
  end if;

  select count(*) into v_rows_this_hour
    from login_events where created_at > now() - interval '1 hour';
  if v_rows_this_hour >= insert_ceiling then
    return;
  end if;

  delete from login_events where created_at < now() - interval '90 days';

  insert into login_events (profile_id, email, event, method, reason, ip_hash)
  values (
    (select id from profiles where id = v_uid),
    -- Prefer the authenticated identity; fall back to what was supplied.
    coalesce((select email from profiles where id = v_uid), lower(nullif(trim(p_email), ''))),
    p_event,
    coalesce(nullif(p_method, ''), 'unknown'),
    -- Truncated: Supabase error strings can be long and this is a label, not a log.
    left(nullif(trim(p_reason), ''), 200),
    p_ip_hash
  );
end;
$$;

grant execute on function record_login_event(text, text, text, text, text) to anon, authenticated;
