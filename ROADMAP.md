# EZcrm — roadmap

Features agreed but not yet built, in the order they were picked. Numbering is
kept from the original list so it matches how they were discussed; it is not a
priority order. [HANDOFF.md](HANDOFF.md) covers how the app works today.

Each entry says what problem it solves, because in six months the *what* will be
obvious from the code and the *why* will not.

---

## Conventions any of these must follow

- **One migration per change**, `supabase/migrations/NNN_name.sql`, written so
  it is safe to re-run (`if not exists`, the `pg_policies` guard pattern), and
  **mirrored into `supabase/schema.sql`** so a fresh project gets it too. Was
  "per feature": features that share a policy belong in one file, because
  applying them separately means writing that policy twice — once with the old
  meaning, once with the new — and whoever runs them out of order silently gets
  the older one. 013 covers three features for exactly that reason.
- **Migrations are applied by hand.** Paste the SQL into the Supabase SQL
  editor. Automated writes to the live database are blocked in this setup, so
  do not assume a migration ran — check `information_schema` before trusting it.
- **Add a `lib/changelog.ts` entry in the same commit** as any user-visible
  change, or `/guide` silently goes stale.
- **RLS is the security boundary**, not application code. Every new table gets
  `enable row level security` and policies in the same migration. Reads use
  `has_access()` ("has a profile"), writes use `is_member()` ("has a profile and
  may write") — that split is the viewer role, so getting it wrong hands a
  viewer write access. Deletes stay narrower again: `is_admin() or created_by =
  auth.uid()`, and for companies, `is_admin()` alone.
- **Never export a non-async function from `app/actions.ts`.** It is
  `'use server'`, so every export must be a server action — plain helpers go in
  `lib/`. This already bit once; `lib/views.ts` exists because of it.
- `npx tsc --noEmit` before calling anything done.

---

## Done

- **#2 Going cold** — `companies.last_touch_at` / `contacts.last_touch_at`,
  maintained by an `AFTER INSERT` trigger on `activities`. Dashboard panel,
  `/companies?cold=1` filter, last-touched column. Migration `007`.
- **#3 Saved views** — `saved_views` table storing the querystring. Chips on
  the companies page, shared with the club by default. Migration `008`.
- **Dark mode** — light/system/dark, by redefining `black` and `white` as CSS
  variables rather than adding `dark:` everywhere. No migration.
- **Sign-in email quota** — `auth_email_requests` + `claim_auth_email()`.
  Supabase's limit is project-wide and can't be raised without custom SMTP, so
  the app now shows what's left and refuses politely instead of spending a
  request to get a 429 back. Migration `009`.
- **#4 Follow-up prompt when logging activity** — the composer offers a next
  step and a due date, collapsed behind a link, and writes the task in the same
  submit. No schema.
- **#5 Global search (⌘K)** — `/api/search` over companies and contacts, and a
  palette mounted in the app layout. Uses `ilike` rather than the GIN indexes on
  purpose: somebody typing into a palette is three letters into a half-
  remembered name, and `to_tsquery('penn')` matches nothing.
- **#7 Duplicate detection on import** — `lib/dedupe.ts` normalises names
  (punctuation, legal suffixes) and compares websites by domain. The importer
  now does a dry run first and shows probable duplicates for a decision instead
  of silently skipping them.
- **#8 Attachments** — private `attachments` bucket, 10 MB a file, uploaded
  browser-to-Storage so nothing passes through a Vercel request body. Reads go
  through a 60-second signed URL. Migration `014`.
- **#9 Sponsorship amounts and a weighted funnel** — `companies.amount` and
  `close_date`, `STATUS_PROBABILITY` in `lib/types.ts`, weighted and committed
  totals on `/pipeline`, amount on the companies list and the board. Migration
  `014`.
- **#10 Season handoff and archiving** — `companies.archived_at` with the filter
  applied to the list, the board and the map; bulk archive and restore;
  `reassign_member()` behind an admin check, surfaced next to Remove. Migration
  `014`.
- **#12 Contact-level engagement** — touch count and last-touched on
  `/contacts`, sorted by most recently touched. `activities(count)` embed, no
  schema.
- **Kanban pipeline board** — drag between columns, optimistic with a rollback
  when the database refuses the move. Native drag and drop, no library.
- **Per-stage deal rotting** — `ROTTING_DEFAULTS` and a `rotting` settings row;
  each stage has its own tolerance and the cold filter is an OR over stages.
- **Required fields by stage** — `check_committed_ready()` refuses "committed"
  without a contact and a date. Deliberately only that transition: gating every
  stage turns a two-second status change into a form. Migration `014`.
- **#6 Email templates + mailto handoff** — built, and then rebuilt. The first
  version kept the four letters in `lib/cold-email.ts` and the club's details in
  browser storage, on the grounds that a table nobody edits is a table nobody
  needs. That was wrong the moment editing them was the point: they are now
  `email_templates` and `settings` rows, edited on `/settings`, with a preview,
  merge-field insertion, and Markdown import/export. The composer on a company
  page still merges the CRM's own fields, suggests a template from the company's
  status, opens `mailto:` and offers "Log as sent"; bulk drafting for a ticked
  selection still downloads a mail-merge CSV. Migration `013`.
- **#11 Activity feed** — went further than planned: rather than unioning three
  tables in application code, `audit_events` is written by triggers on
  companies, contacts, tasks, activities, deletion requests, `profiles` and
  `allowed_emails`, so a write from the SQL editor is logged the same as one
  from the UI. Imports and exports are logged by the app, since an export is a
  read and no trigger can see it. `/activity` groups by day and collapses runs.
  Migrations `013`/`014`.
- **Company deletion tracking and approvals** — deletes narrowed to admins,
  everyone else files a request an admin approves or declines on `/deletions`,
  and every deletion is recorded with a row snapshot that outlives the company.
  Migration `013`.
- **Viewer role** — see the reversal note under "Deliberately not doing".
  Migration `013`.
- **Contact org chart** — `contacts.reports_to` and `contacts.division`, drawn
  as a tree on the company page. The database refuses cross-company managers
  and reporting loops. Migration `015`.
- **Login tracking** — `login_events`, written from all three sign-in paths.
  Supabase's own audit log is pruned and unreadable without a service-role key.
  Shows links requested against sessions started. Migration `010`.

  **Still worth doing here:** the failure breakdown exists to answer one
  question — whether to point the Supabase email template at `/auth/confirm`.
  If PKCE failures dominate after a few weeks of real use, make that change;
  it removes the "must open in the same browser" constraint entirely.

---

## #13 Weekly digest to officers

**Problem.** Nobody opens a CRM they aren't prompted to open.

**Status: written, not deployed.** `supabase/functions/weekly-digest/index.ts`
is the function — new companies, status moves, going-cold and overdue tasks,
mailed to admins — and `schedule.sql` next to it is the `pg_cron` job.

**Blocked on two secrets that must not live in this repository:** a Resend API
key and a service-role key, both set as Edge Function secrets. That is the one
place a service-role key is acceptable: it stays inside the function, on a timer
with no signed-in user for RLS to read, and the Next.js app still has no way to
reach it.

To finish it:

```
supabase secrets set RESEND_API_KEY=...
supabase secrets set DIGEST_SECRET=...        # any long random string
supabase functions deploy weekly-digest
# then edit and run supabase/functions/weekly-digest/schedule.sql
```

## Borrowed from the big CRMs — to keep or lose

Surveyed Attio, HubSpot, Pipedrive, Salesforce and Dynamics 365 (August 2026)
and pulled everything that a five-person club running free-tier Supabase could
plausibly use. Nothing here is agreed. Each entry says what it is, who does it,
and — the part that matters — whether it survives contact with this app's
actual constraints: no service-role key, no paid tier, no full-time admin, and
users who open the CRM once a week at best.

The recurring reason to cut is not difficulty. It is that most CRM features
assume a full-time seller with a quota, and this app is used by volunteers
between lectures.

### Strong candidates — all now built

Every row here shipped; kept for the reasoning rather than as a plan.

- **Kanban pipeline board** (Pipedrive's core, HubSpot deal board). Drag a
  company between statuses instead of using the dropdown. `/pipeline` already
  computes the columns; this is a drag handle and one server action on top of
  the existing `setCompanyStatus`. Best effort-to-payoff ratio on this list.
- **Deal rotting** (Pipedrive). A per-stage staleness threshold rather than one
  global `COLD_AFTER_DAYS`: a week in "contacted" is fine, a month in "in
  conversation" is not. Small change to `isCold`, no schema.
- **Duplicate detection with merge** (Dynamics and Salesforce both treat this as
  core; Dynamics blocks server-side on import). #7 already plans detection on
  import. The half worth stealing is *merge*: pick a master, keep both sets of
  contacts and activity. Deduplication after the fact is the actual club
  problem, since two officers add the same factory a month apart.
- **Required-fields-by-stage** (Salesforce validation rules, lightweight
  version). A company cannot reach "committed" without a named contact and a
  date. One check constraint or one trigger; stops the pipeline chart from
  lying.
- **Templates with merge fields** (HubSpot sequences, minus the sending). #6
  already plans this. Worth confirming it stays a `mailto:` handoff — the moment
  the app sends mail on your behalf it inherits deliverability, unsubscribes and
  a compliance surface.

### Worth arguing about

- **Custom fields / flexible objects** (Attio's whole pitch). Genuinely useful —
  every club wants one field nobody anticipated. But a per-workspace schema
  means an EAV table or a `jsonb` blob, and both make every query and every RLS
  policy harder forever. Probably: three spare labelled text columns instead,
  and admit it.
- **Reporting dashboard with saved charts** (all five). `/pipeline` is already
  most of it. The rest is a chart builder, which is a project, for five people
  who mostly want one number: how many tours are booked.
- **Lead inbox** (Pipedrive). A staging area before something becomes a real
  company. The club's equivalent is the CSV import, which already exists. Only
  worth it if a public tour-request form ever happens — and that is on the
  do-not-do list for good reasons.
- **Meeting scheduling links** (HubSpot, Pipedrive). Real value for tour
  booking, but it is a calendar-availability product, not a CRM feature. Point
  people at Calendly and put the link in a template.
- **Mobile app / offline** (all five). Members log tours from a plant floor,
  which is the strongest argument on this list. The rail already collapses on
  phones; a PWA with offline queueing is a much bigger commitment than it looks
  and would be the first thing here that can lose data.

### Cut

- **AI everything** — Attio's research agent, Pipedrive's deal scoring,
  Copilot for Sales. Prediction needs training data this club will never have:
  a few hundred companies and maybe forty outcomes a season. A model fitted to
  that is a confident random number generator.
- **Forecasting, quotas, territories, commission** (Salesforce, Dynamics). No
  revenue, no quota, no territories. Nothing to forecast.
- **Email sending, sequences, open tracking** (HubSpot). Covered under
  "deliberately not doing" — the OAuth and compliance surface dwarfs the app.
  Open tracking is also a pixel in someone's inbox, which is a thing to do to
  strangers, not to a factory manager who agreed to host sixteen students.
- **Live chat / shared team inbox** (HubSpot, Pipedrive). Nobody is staffing a
  chat widget.
- **Approval workflows in general** (Dynamics). The one place approval mattered
  — deletion — is built. Generalising it would be machinery in search of a use.
- **Territory-based record access** (Salesforce, Dynamics). The club shares one
  workspace on purpose; per-record visibility would make "who owns this" a
  permissions question instead of a social one.

---

## Deliberately not doing

- **In-app email inbox / Gmail sync.** OAuth scopes, token refresh, and a
  compliance surface wildly out of proportion to five users.
- ~~**Roles beyond member/admin.**~~ **Reversed, and built.** The reasoning was
  that five people don't need roles. What it missed is that the people who need
  to *see* the pipeline are not always the five: a treasurer, a supervising
  teacher, an incoming committee member mid-handover. The alternative was making
  them members, which is also permission to retier 1,200 companies. `viewer`
  exists as of migration `013`; `is_member()` now means "may write" and
  `has_access()` means "has a profile". The fragile part of the original
  objection was right, though, and is why role changes still go through
  `set_member_role()`.
- **A public tour-request form.** Attractive, but an unauthenticated write path
  is the first real hole in "everything is behind RLS". If it ever happens it
  needs its own restricted role, a rate limit, and its own security review.
