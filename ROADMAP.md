# EZcrm — roadmap

Features agreed but not yet built, in the order they were picked. Numbering is
kept from the original list so it matches how they were discussed; it is not a
priority order. [HANDOFF.md](HANDOFF.md) covers how the app works today.

Each entry says what problem it solves, because in six months the *what* will be
obvious from the code and the *why* will not.

---

## Conventions any of these must follow

- **One migration per feature**, `supabase/migrations/NNN_name.sql`, written so
  it is safe to re-run (`if not exists`, the `pg_policies` guard pattern), and
  **mirrored into `supabase/schema.sql`** so a fresh project gets it too.
- **Migrations are applied by hand.** Paste the SQL into the Supabase SQL
  editor. Automated writes to the live database are blocked in this setup, so
  do not assume a migration ran — check `information_schema` before trusting it.
- **Add a `lib/changelog.ts` entry in the same commit** as any user-visible
  change, or `/guide` silently goes stale.
- **RLS is the security boundary**, not application code. Every new table gets
  `enable row level security` and policies in the same migration. Deletes stay
  narrower than writes: `is_admin() or created_by = auth.uid()`.
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
- **Login tracking** — `login_events`, written from all three sign-in paths.
  Supabase's own audit log is pruned and unreadable without a service-role key.
  Shows links requested against sessions started. Migration `010`.

  **Still worth doing here:** the failure breakdown exists to answer one
  question — whether to point the Supabase email template at `/auth/confirm`.
  If PKCE failures dominate after a few weeks of real use, make that change;
  it removes the "must open in the same browser" constraint entirely.

---

## #4 Follow-up prompt when logging activity

**Problem.** The gap between "I talked to them" and "someone owes them something
next" is where outreach dies. Logging a call and creating the follow-up task are
currently two separate deliberate acts, so the second one often doesn't happen.

**Shape.** No schema. Extend `logActivity` in `app/actions.ts` to also insert a
task when the composer's follow-up fields are filled in. Add to
`components/activity-composer.tsx`: a "next step" text field and a due-date,
defaulted to about a week out, collapsed behind a link until wanted.

Worth considering: after logging, if the company has no open task, show a
one-click "remind me in a week" rather than a form.

---

## #5 Global search (⌘K)

**Problem.** Finding a company means going to the companies page and filtering.
Fine at 1,200 records with a plan; bad when someone says a name on a call.

**Shape.** The expensive part is already done — `companies_search` and
`contacts_search` GIN indexes exist in `schema.sql`. Add `/api/search?q=`
querying both, capped at ~10 each, and a client palette component mounted in
`app/(app)/layout.tsx` bound to ⌘K / Ctrl-K. Arrow keys and Enter to navigate.

Use the existing `ilike` approach for short queries and `textSearch` for longer
ones — the GIN index does nothing for a two-letter prefix.

---

## #6 Email templates + mailto handoff

**Problem.** The club sends the same four emails all year. New members rewrite
them worse. Nobody can see what the good version was.

**Shape.** `templates` table (`name`, `subject`, `body`, `created_by`), member
read/write, delete limited to author or admin. A `/templates` page to manage
them, and a picker on the company page that merges `{{first_name}}`,
`{{company}}`, `{{my_name}}` and opens `mailto:` — so the member's own mail
client sends it.

**Deliberately not sending mail from the app.** That would mean deliverability,
an API key with send rights, and the club's domain reputation. `mailto:` keeps
all of that out of scope and the sent mail in the member's own Sent folder.

Offer a one-click "log this as an activity" after opening the draft, since we
cannot know whether they actually sent it.

---

## #7 Duplicate detection on import

**Problem.** `/api/import` currently skips a row only on an exact
case-insensitive name match. Two members importing overlapping lists silently
fork every company that differs by "Inc." or a comma.

**Shape.** Normalise before comparing: lowercase, strip punctuation and the
common suffixes (Inc, LLC, Corp, Co, Ltd), collapse whitespace. Match on that
plus website domain. Then a review step in `components/csv-import.tsx`: show
probable duplicates side by side and let the importer merge, skip, or keep both.

**Do this in JavaScript, not `pg_trgm`.** It avoids an extension dependency and
keeps the decision in front of a human, which is what actually matters here.

---

## #8 Attachments

**Problem.** Signed agreements, sponsorship decks, and tour waivers live in one
member's Drive and leave with them when they graduate.

**Shape.** Supabase Storage, private bucket `attachments`, 10 MB a file (the
free tier gives 1 GB total). An `attachments` table as the index
(`company_id`, `name`, `path`, `mime`, `size_bytes`, `created_by`).

Upload **client-side** via `lib/supabase-browser.ts` straight to Storage, then a
server action records the row — this keeps files out of the Vercel request body
and its size limit entirely. Reads go through a short-lived signed URL minted
for a member; the bucket must stay private so a path cannot be guessed.

Storage policies live on `storage.objects` and need `bucket_id = 'attachments'`
in every clause, or they leak across buckets. Note the `pg_policies` guard needs
`schemaname = 'storage'`.

---

## #9 Sponsorship amounts and a weighted funnel

**Problem.** `companies.interest` records that someone wants sponsorship. There
is no money anywhere in the app, so the pipeline chart counts logos rather than
dollars — and a count is not what you show an advisor or a successor.

**Shape.** `companies.amount numeric(12,2)` and `close_date date`. A probability
per status (roughly: prospect 5%, contacted 15%, in conversation 40%, committed
100%, declined and dormant 0) in `lib/types.ts`. Then weighted totals on
`/pipeline`, and amount as a column and sort on the companies list.

Keep it on `companies` rather than inventing a `deals` table. A club pursues one
relationship per company; multiple concurrent deals is a shape this does not
have, and modelling it would cost every query a join for nothing.

---

## #10 Season handoff and archiving

**Problem.** This is a student club: the roster turns over every year. Nothing
in the app handles a member graduating, and a successor inherits 1,200 rows with
no idea which are live.

**Shape.** Two independent pieces.

*Archiving.* `companies.archived_at timestamptz`. Every working query gains
`.is('archived_at', null)` unless `?archived=1`. Bulk-archive from the existing
selection bar. Archiving is not deleting — the history stays.

*Handoff.* A `reassign_member(from_member, to_member)` SECURITY DEFINER function
that moves `companies.owner_id` and open `tasks.assignee_id` in one statement.
Admin-only, because it rewrites other people's assignments. Surface it on
`/members` next to the remove control, since removing someone without moving
their work is the mistake it exists to prevent.

**This is the feature most club CRMs lack and most need.** It is also the one
with the widest blast radius — the `archived_at` filter has to be added to every
list, the map, and the pipeline, and missing one means a page quietly disagrees
with the others.

---

## #11 Activity feed

**Problem.** Members can't see each other's work, so there's no sense of whether
anything is happening. Cheap social pressure is most of what makes a shared CRM
get used.

**Shape.** No schema. An `/activity` page merging `activities`, `status_events`,
and task completions into one reverse-chronological list, filterable by member.
Three queries unioned in application code and sorted; at this size that is
cheaper than a view and far easier to change.

---

## #12 Contact-level engagement

**Problem.** Activities link to a contact but nothing aggregates per person, so
nobody knows which individual at a company actually replies.

**Shape.** `contacts.last_touch_at` already exists — migration `007` added it.
Remaining work is display: a touch count and last-touched column on
`/contacts`, sortable, and on the company page mark the most responsive contact.

The cheapest useful version is a `activities(count)` embed plus the existing
`last_touch_at`. Anything more (reply rates, response times) needs data the CRM
does not capture and probably shouldn't try to.

---

## #13 Weekly digest to officers

**Problem.** Nobody opens a CRM they aren't prompted to open.

**Shape.** A Supabase Edge Function `weekly-digest` plus a `pg_cron` schedule,
emailing via Resend's free tier (3k/month). Content: new companies, status
moves, tours booked, tasks overdue, and the going-cold list from #2.

**This is the one that needs a secret.** The function needs a service-role key
or its own restricted role to read across members, and a Resend API key — both
as Edge Function secrets, never in the repo and never in `NEXT_PUBLIC_*`. The
app's "no service-role key anywhere" property is a real security property worth
preserving; keeping the key inside the Edge Function rather than the Next.js app
is what preserves it.

Build #1 (per-assignee task reminders) at the same time — same cron, same
Resend account, most of the same code.

---

## Deliberately not doing

- **In-app email inbox / Gmail sync.** OAuth scopes, token refresh, and a
  compliance surface wildly out of proportion to five users.
- **Roles beyond member/admin.** Five people don't need them, and the
  column-privilege setup on `profiles` is currently correct and fragile — see
  migration `006`.
- **A public tour-request form.** Attractive, but an unauthenticated write path
  is the first real hole in "everything is behind RLS". If it ever happens it
  needs its own restricted role, a rate limit, and its own security review.
