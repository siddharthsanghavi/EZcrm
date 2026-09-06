-- Schedule the weekly digest. Run this ONLY after the function is deployed and
-- its secrets are set — a cron job calling a function that cannot send is just
-- a weekly error nobody sees.
--
--   supabase secrets set RESEND_API_KEY=...
--   supabase secrets set DIGEST_SECRET=...        -- any long random string
--   supabase functions deploy weekly-digest
--
-- Then replace YOUR-PROJECT-REF and YOUR-DIGEST-SECRET below and run it.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Monday at 08:00 UTC. A digest that lands mid-week reads as noise; one that
-- lands before the week starts is a to-do list.
select cron.schedule(
  'weekly-digest',
  '0 8 * * 1',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/weekly-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-digest-secret', 'YOUR-DIGEST-SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To stop it:            select cron.unschedule('weekly-digest');
-- To see what it did:    select * from cron.job_run_details order by start_time desc limit 10;
