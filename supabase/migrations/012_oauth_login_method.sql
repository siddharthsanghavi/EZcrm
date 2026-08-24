-- Record Google sign-ins distinctly in the login tracker.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
-- OAuth uses the same PKCE code exchange as a magic link, so /auth/callback
-- would otherwise log it as 'pkce' and the two would be indistinguishable. The
-- whole point of the failure breakdown on /members is to answer "is the
-- wrong-browser problem worth fixing" -- which becomes unanswerable if Google
-- sign-ins are mixed into the same bucket.
--
-- Note the allowlist gate is unchanged and still governs: handle_new_user only
-- creates a profile for an address in allowed_emails, so signing in with Google
-- does not by itself grant access to anything.

alter table login_events drop constraint if exists login_events_method_check;

alter table login_events add constraint login_events_method_check
  check (method in ('pkce', 'token_hash', 'implicit', 'oauth', 'unknown'));
