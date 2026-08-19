-- Hardening pass, prompted by Supabase's database linter.
--
-- A SECURITY DEFINER function without a pinned search_path can be tricked into
-- resolving an unqualified name to an attacker-controlled object. Pin it.
alter function public.touch_updated_at() set search_path = public, pg_temp;

-- Every function in `public` is also published as a REST endpoint
-- (/rest/v1/rpc/<name>). These two are only ever fired by triggers, so nothing
-- should be able to call them directly.
revoke execute on function public.handle_new_user()  from anon, authenticated, public;
revoke execute on function public.touch_updated_at() from anon, authenticated, public;

-- is_member() and is_admin() deliberately KEEP their EXECUTE grant.
--
-- Tested the hard way: revoking it breaks the whole app. RLS policy evaluation
-- runs as the querying role, so a member loses EXECUTE and every SELECT fails
-- with "permission denied for function is_member" instead of returning rows.
--
-- Supabase's linter still flags them as publicly callable. That is acceptable
-- here: both take no arguments and report only whether *the caller* is a member
-- or admin. They disclose nothing about any other user, and the answer is
-- already implied by whether the caller's queries return rows.
grant execute on function public.is_member() to anon, authenticated;
grant execute on function public.is_admin()  to anon, authenticated;
