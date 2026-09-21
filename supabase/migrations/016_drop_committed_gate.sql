-- Remove the "committed" stage gate.
-- Safe to re-run; mirrored into supabase/schema.sql for fresh projects.
--
-- 014 made "committed" refuse to save without a close date and a named contact,
-- on the theory that a committed row with nobody's name on it turns the
-- pipeline chart into a promise nobody made. In practice it did the opposite of
-- what a stage gate should: the person marking a company committed is the one
-- who just got the yes, and being sent to two other forms first — one of them
-- only after clearing the first — is how a status stops getting updated at all.
--
-- The date and the contact are still worth having, and the pipeline still
-- weights on them. They are just no longer a precondition.

drop trigger if exists companies_committed_gate on companies;
drop function if exists check_committed_ready();
