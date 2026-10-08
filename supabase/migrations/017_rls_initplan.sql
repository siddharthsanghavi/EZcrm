-- Evaluate access checks once per query, not once per row.
-- Safe to re-run; mirrored into supabase/schema.sql for fresh projects.
--
-- Every read policy said `using (has_access())`. has_access() is SECURITY
-- DEFINER, so Postgres cannot inline it, and as a row-level-security qual it is
-- applied as a per-row filter: counting 1,267 companies called it 1,267 times,
-- each a lookup in `profiles`. Measured as a signed-in admin:
--
--   count(*) from companies             15.0 ms  ->  0.22 ms
--   the pipeline board's query          17.2 ms  ->  1.4 ms
--
-- Wrapping the call in a scalar subquery — `(select has_access())` — makes the
-- planner run it once as an InitPlan and reuse the answer. The functions take no
-- row arguments, so the result is identical; only the number of calls changes.
-- Same for is_member(), is_admin() and auth.uid().
--
-- Policy semantics are unchanged. In particular this does NOT touch EXECUTE
-- grants on the helper functions — revoking those breaks every member query.

-- ------------------------------------------------------------- reads

alter policy activities_read        on activities        using ((select has_access()));
alter policy attachments_read       on attachments       using ((select has_access()));
alter policy audit_events_read      on audit_events      using ((select has_access()));
alter policy companies_read         on companies         using ((select has_access()));
alter policy company_deletions_read on company_deletions using ((select has_access()));
alter policy company_locations_read on company_locations using ((select has_access()));
alter policy contacts_read          on contacts          using ((select has_access()));
alter policy deletion_requests_read on deletion_requests using ((select has_access()));
alter policy email_templates_read   on email_templates   using ((select has_access()));
alter policy profiles_read          on profiles          using ((select has_access()));
alter policy settings_read          on settings          using ((select has_access()));
alter policy status_events_read     on status_events     using ((select has_access()));
alter policy tasks_read             on tasks             using ((select has_access()));
alter policy saved_views_read       on saved_views
  using ((select has_access()) and (shared or owner_id = (select auth.uid())));

alter policy geocache_read               on geocache            using ((select is_member()));
alter policy auth_email_requests_admin_read on auth_email_requests using ((select is_admin()));
alter policy login_events_admin_read     on login_events        using ((select is_admin()));

-- ------------------------------------------------------------ writes

alter policy activities_insert        on activities        with check ((select is_member()));
alter policy attachments_insert       on attachments       with check ((select is_member()));
alter policy companies_insert         on companies         with check ((select is_member()));
alter policy company_locations_insert on company_locations with check ((select is_member()));
alter policy contacts_insert          on contacts          with check ((select is_member()));
alter policy email_templates_insert   on email_templates   with check ((select is_member()));
alter policy geocache_write           on geocache          with check ((select is_member()));
alter policy status_events_insert     on status_events     with check ((select is_member()));
alter policy tasks_insert             on tasks             with check ((select is_member()));

alter policy activities_update      on activities      using ((select is_member())) with check ((select is_member()));
alter policy companies_update       on companies       using ((select is_member())) with check ((select is_member()));
alter policy contacts_update        on contacts        using ((select is_member())) with check ((select is_member()));
alter policy email_templates_update on email_templates using ((select is_member())) with check ((select is_member()));
alter policy geocache_update        on geocache        using ((select is_member())) with check ((select is_member()));
alter policy tasks_update           on tasks           using ((select is_member())) with check ((select is_member()));
alter policy company_locations_update on company_locations using ((select is_member()));

alter policy companies_delete         on companies         using ((select is_admin()));
alter policy company_locations_delete on company_locations using ((select is_member()));
alter policy activities_delete      on activities      using ((select is_admin()) or created_by = (select auth.uid()));
alter policy attachments_delete     on attachments     using ((select is_admin()) or created_by = (select auth.uid()));
alter policy contacts_delete        on contacts        using ((select is_admin()) or created_by = (select auth.uid()));
alter policy email_templates_delete on email_templates using ((select is_admin()) or created_by = (select auth.uid()));
alter policy tasks_delete           on tasks           using ((select is_admin()) or created_by = (select auth.uid()));

alter policy allowed_emails_admin on allowed_emails using ((select is_admin())) with check ((select is_admin()));
alter policy settings_write       on settings       using ((select is_admin())) with check ((select is_admin()));

alter policy profiles_self_update on profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter policy saved_views_insert on saved_views
  with check ((select is_member()) and owner_id = (select auth.uid()));
alter policy saved_views_update on saved_views
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy saved_views_delete on saved_views
  using ((select is_admin()) or owner_id = (select auth.uid()));

alter policy deletion_requests_insert on deletion_requests
  with check ((select is_member()) and requested_by = (select auth.uid()) and status = 'pending');
alter policy deletion_requests_withdraw on deletion_requests
  using (requested_by = (select auth.uid()) and status = 'pending')
  with check (requested_by = (select auth.uid()) and status = 'withdrawn');
