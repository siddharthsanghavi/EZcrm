# EZcrm — Maintainer notes

For whoever works on the code. [SETUP.md](SETUP.md) covers installing and
deploying; the in-app **/guide** page is the user manual. This file is the
things you'd otherwise have to rediscover the hard way.

> Deployment-specific details — URLs, project refs, who's on the team — belong in
> `DEPLOYMENT.local.md`, which is gitignored. Keep them out of this repo so it
> stays shareable.
>
> Agreed but unbuilt work is in [ROADMAP.md](ROADMAP.md), with the reasoning
> behind each one written down while it was still fresh.

---

## What this is

A small CRM for a student club running outreach to companies, asking for plant
tours and sponsorship. Built for a handful of users on free tiers, with access
control enforced in Postgres rather than in application code.

Next.js (App Router) + Supabase + Vercel. No paid services.

---

## Shape of the thing

**Tables** — `companies`, `contacts`, `activities`, `tasks`, `status_events`,
`saved_views`, `attachments`, plus `profiles` and `allowed_emails` for access,
`geocache` for map coordinates, `auth_email_requests` / `login_events` for
sign-in tracking (both admin-read-only, both revoked from `anon`), and four
added later: `audit_events` (the activity feed), `deletion_requests` and
`company_deletions` (asking to delete, and the record of it), `settings` and
`email_templates` (what the club calls itself and the letters it sends).

**Pages** — Dashboard (status counts, goal bars, going cold, tasks, activity),
Companies (filters, search, pagination, bulk assign/status/tier/archive/delete,
CSV draft export), Company detail (status, owner, tier, cold-email composer,
activity, contact tree, tasks, files, history), Pipeline (draggable board,
weighted money, flowchart), Map, Contacts, Tasks, Activity, Deletions,
Import/Export, Settings (club, goal, going-cold rules, email templates,
members), Guide.

**Roles** — `viewer` reads everything and writes nothing, `member` reads and
writes, `admin` also manages people and is the only role that can delete a
company. The split lives in two functions: `has_access()` ("has a profile")
backs every read policy, `is_member()` ("may write") backs every write policy.
Get those the wrong way round on a new table and a viewer silently gains write
access — this is the single easiest mistake to make in this schema.

**Behaviour worth knowing**

- `status_events` records every status change with who and when, via an
  `AFTER UPDATE` trigger — so bulk updates and raw SQL are captured too, not
  just the UI.

- `companies.last_touch_at` and `contacts.last_touch_at` are maintained the same
  way, by an `AFTER INSERT` trigger on `activities`. Use these — **not
  `updated_at`** — to judge whether anyone has actually been in contact;
  `updated_at` moves when someone fixes a typo. The trigger refuses to move a
  touch backwards, so back-dating an old call can't make a company look colder.

- **`audit_events` is the activity feed**, written by triggers on companies,
  contacts, tasks, activities, deletion requests, profiles and `allowed_emails`.
  A write from the SQL editor is logged exactly like one from the UI. Imports
  and exports are logged by the app instead, because an export is a SELECT and
  no trigger can see one. Sign-ins are deliberately absent — they live in
  `login_events`, which is admin-only.

- **Deleting a company is admin-only**, and everyone else files a
  `deletion_requests` row that an admin approves or declines on `/deletions`.
  Every deletion is recorded in `company_deletions` with a jsonb snapshot of the
  row, and that table has no foreign key on purpose: it has to outlive the thing
  it describes.

- **Email templates and club details are rows, not code** (`email_templates`,
  `settings`). `lib/cold-email.ts` turns a template plus a company into a draft;
  the app never sends mail, it hands a `mailto:` to the member's own client. The
  repository ships skeletons — the club's real letters live only in its own
  database, exportable as Markdown from `/settings`.

- **"Committed" is gated.** `check_committed_ready()` refuses the transition
  without a contact and a close date. That refusal is a Postgres exception, so
  any UI that sets status has to be able to show it — `components/status-picker.tsx`
  and the board both do. A plain `<form action>` swallows it and the control
  just snaps back.

- **Going cold is per stage**, configured in `settings` under `rotting`.
  `isCold()` in `lib/types.ts` says the rule in TypeScript and the companies
  page says the same thing to PostgREST as an OR of one clause per stage. They
  have to change together — that is the one duplication in this codebase that is
  deliberate, because a server-side filter and a client-side highlight cannot
  share an implementation.

- **The visual system is "Console"**, chosen from two directions drafted on a
  design canvas. What it commits to: a nav **rail** with per-section counts
  (`components/nav-rail.tsx`, collapsing to a top strip below `lg` — members
  work from phones on plant floors), **Archivo** self-hosted via `next/font`,
  **teal (`--accent`) alongside amber**, flat `10px` cards with no shadow, and
  status as a **dot plus a word** (`STATUS_DOTS`) rather than a pastel pill.

  Chips (`STATUS_STYLES`) still exist and are still right where the status is
  the subject rather than one column of many — the company detail header. Don't
  "finish the job" by replacing those too.

  One measured constraint worth keeping: in dark mode `--rail` equals
  `--surface`, mirroring light mode where both are white. Recessing the rail
  instead was tried and is measurably worse — against a near-black page, going
  darker tops out near a 1.05 contrast ratio, so the rail stops reading as a
  region at all.

- **Dark mode redefines what `black` and `white` mean**, rather than adding 190
  `dark:` variants. `tailwind.config.ts` maps `black` to a `--fg` variable and
  `white` to `--surface`, so every existing `text-black/45` and `bg-white`
  inverts on its own. The consequence: **`text-white` is not a literal white.**
  On `.btn-primary` that is the point — it yields a light button with dark text
  in dark mode. If you ever need a real white, write `text-[#fff]`.

  Things that can't follow the tokens and so are handled by hand: the status and
  tier chips (`dark:` variants in `lib/types.ts`), the pipeline SVG (CSS
  variables, since `dark:` can't touch an SVG `fill`), and Leaflet's own chrome.
  The map has no dark tiles — the tile pane is CSS-inverted, which is why the
  filter is scoped to `.leaflet-tile-pane` and not the whole map.

- **Google sign-in is offered only when it actually works.** `signInWithOAuth`
  does NOT return an error for a disabled provider — it navigates the browser to
  Supabase, which serves a raw JSON 400 on the `supabase.co` domain, stranding
  the visitor with no client-side handler able to catch it. So
  `app/auth-providers.ts` probes `/auth/v1/authorize?provider=google` from the
  server (a 3xx means enabled, 400 means not) and the button is only rendered on
  a positive answer. The probe revalidates every 5 minutes, so enabling the
  provider in the dashboard makes the button appear **without a redeploy**.
  Setup steps are in SETUP.md Part F.

  **Google does not widen access.** `handle_new_user` still only creates a
  profile for an address in `allowed_emails`; a stranger signing in with Google
  lands on `/no-access` exactly as before. Verified before shipping.

  Keep the magic link as a fallback. It is the only path that works if OAuth is
  ever misconfigured, and removing it would make a bad Google config a total
  lockout — including for the admin who needs to fix it.

- **Sign-in emails are capped project-wide, not per user.** Supabase's docs are
  explicit: the limit is a "sum of combined requests project-wide" and is
  customisable "Custom SMTP Only". So two members signing in can lock out a
  third. `app/auth-quota.ts` + migration `009` track and enforce it, and the
  limit lives in `claim_auth_email()` in the database — **not** an env var, so a
  caller can't pass a bigger number. If you set up custom SMTP, raise it in that
  function to match the dashboard.

  `app/auth-quota.ts` holds the app's **only unauthenticated server actions**.
  That is why `auth_email_requests` is revoked from `anon` outright and the
  functions return counts but never addresses — otherwise the login page becomes
  a way to enumerate club members. A claim also only counts for 60 seconds
  unless confirmed, so hammering the endpoint can't fake an hour-long lockout.

  **The `signInWithOtp` call itself was deliberately left in the browser.** The
  limit check happens before it. Moving it server-side would change where the
  PKCE verifier is stored, and auth is the one part of this app you cannot break
  quietly.

- **Sign-ins are logged by the app, not by Supabase.** `auth.audit_log_entries`
  exists but is pruned — it was empty on the live project when this was written —
  and `auth.users` / `auth.sessions` aren't readable by `authenticated`, since
  there's no service-role key here by design. So `login_events` (migration `010`)
  records it, written from **all three** sign-in paths: `/auth/callback` (PKCE),
  `/auth/confirm` (token hash), and the implicit flow that finishes in the
  browser via `app/auth-events.ts`. **Add a fourth path and you must log it too,
  or the numbers quietly under-report.**

  `recordLogin` swallows every error on purpose. A tracker that can lock the club
  out of its own CRM is worse than no tracker — and `record_login_event` returns
  rather than raising on a bad event name for the same reason.

- `app/actions.ts` is `'use server'`: **every export must be an async action.**
  Exporting a plain helper from it is a build error. Shared non-action helpers
  go in `lib/` — that's why `lib/views.ts` exists.
- `companies.area` is a computed region, assigned by nearest anchor from the
  coordinates. The anchor list in `ez_area()` is **specific to one US state** —
  replace it for your own geography. Anything that moves a company's point must
  recompute it, which is why `set_company_point()` exists.

- **Geocoding is two-tier.** Cities come from Nominatim via
  `scripts/geocode_cities.py` (a one-off, run by hand). Street addresses come
  from the **US Census Bureau batch geocoder** via the `geocode` Edge Function,
  triggered from Import / Export by an admin. Census was chosen because it needs
  no API key, has no billing to forget, takes 10,000 addresses per batch, and is
  the authoritative source for US street geometry.

  **It cannot run from Postgres.** The `http` extension is installed and reaches
  most hosts fine, but TLS to `geocoding.geo.census.gov` fails with
  `SSL_ERROR_SYSCALL` from Supabase's libcurl while succeeding from Deno and
  curl. Don't spend an afternoon rediscovering that — the HTTP call belongs in
  the Edge Function.

  The Edge Function is also **the only place a service-role key is used**, which
  is what keeps "no service-role key in the app" true. It authorises the *caller*
  as an admin via their own JWT before touching anything.

  **Never write a geocode result without validating it.** A wrong answer arrives
  looking exactly like a right one. The function requires a `Match`, a point
  inside the Georgia bounding box, AND a point within 40km of the town centre
  already on file — that last check is the one that catches a confident match in
  the wrong town.

- **Roughly 45% of companies can never be pinned precisely**, because their
  `address` is a placeholder like `"Atlanta, GA (verify address)"`. That is a
  source-data gap, not a geocoder problem, and no service can fix it.
- The map swaps layers at zoom 9: region bubbles below, individual companies
  above. **Clustering stays on at every zoom, deliberately.** Every company is
  geocoded to its town centre — `geo_precision` is `'city'` for all of them — so
  1,248 companies sit on ~224 distinct points, 87 of them on Atlanta's single
  coordinate. `disableClusteringAtZoom: 13` used to be set, and because the
  library computes `_maxZoom = disableClusteringAtZoom - 1`, clustering stopped
  at zoom 12; above that all 87 Atlanta markers drew on one pixel with no
  cluster to click, so `spiderfyOnMaxZoom` never fired and 86 of them were
  unreachable. Don't re-add it unless the data gains real street-level
  coordinates.
- `/guide` renders `lib/changelog.ts`. **Add an entry there in the same commit
  as any user-visible change**, or the guide silently goes stale.

---

## Traps — each of these cost real time

**Do not revoke EXECUTE on `is_member()` / `is_admin()`.** Supabase's linter
flags them as publicly callable and it's tempting to "fix". RLS policy
evaluation runs as the querying role, so revoking breaks every member query with
`permission denied for function is_member`. Already happened once.

**Never merge the two Supabase modules.** `lib/supabase.ts` imports
`next/headers` and is `server-only`; `lib/supabase-browser.ts` is for Client
Components. Merging them makes the login page pull `next/headers` into the
browser bundle → 500 on every route. Already happened once.

**`profiles` has column-level privileges.** `authenticated` may update
`full_name` only; role changes go through `set_member_role()`. A plain
`update profiles set role = …` will be denied. That's deliberate — see Security
below. Re-granting blanket `UPDATE` on `profiles` reopens a privilege
escalation.

**`NEXT_PUBLIC_*` is inlined at build time.** Saving env vars in the Vercel
dashboard does nothing to the live deployment. Redeploy with build cache
disabled.

**Vercel preview URLs are SSO-walled.** The long
`project-<hash>-<team>.vercel.app` form redirects to `vercel.com/sso-api`, so
anyone you share it with is asked to log into *your* Vercel account. Share only
the clean domain. Signing in from a preview URL also fails auth, because the
callback host won't match Supabase's redirect allowlist.

**Supabase silently falls back to Site URL.** If a redirect URL isn't on the
allowlist, Supabase doesn't error — it ignores your `emailRedirectTo` and uses
Site URL instead. A sign-in that lands somewhere unexpected almost always means
this.

**A Server Component formats dates in the SERVER's timezone, which is UTC on
Vercel.** `toLocaleTimeString()` and `Date.now()` in a Server Component are not
the reader's clock. The sign-in charts shipped with every hour label four hours
out for anyone in Georgia — a 6:03pm sign-in rendered under "10 PM". Anything
showing an absolute time or bucketing by day/hour has to be a Client Component
that resolves `Date.now()` after mount (the trackers use a `useState(null)` +
`useEffect` skeleton so the first render still matches the server).

While you're there: bucket to the top of the local hour, not to "now minus n
hours". Rolling buckets labelled as clock hours mean a bar marked 6 PM actually
covers 5:52–6:52.

**Magic links are bound to the browser that requested them.** The PKCE verifier
lives in a cookie, so opening the link in a mail app's in-app browser fails.
`/auth/confirm` (token-hash flow) avoids this entirely — point the Supabase
email template at it.

**A 100% success rate can hide a large error rate.** Geocoding once returned a
hit for every single place and looked perfect; ~8% were wrong by up to several
hundred kilometres, because place names collide with county names and free-text
lookup preferred the wrong one. Validate results against a bounding box and a
sanity distance, not just a hit count. Use structured queries, not free text.

**`next dev` and `next build` fight over `.next/`.** Building while dev runs
corrupts it and the dev server starts 500ing. Stop dev, delete `.next`, restart.

**Stale dev servers hide on the next port.** If 3000 is taken, Next silently
uses 3001 — so you end up verifying a server nobody is looking at. Kill all node
processes and confirm the port before trusting a local result.

**Don't keep the working copy in OneDrive/Dropbox.** Sync corrupts
`node_modules/` and `.next/` mid-write, producing `invalid distance code` and
phantom missing modules.

---

## Security model

- Magic-link sign-in; no passwords stored.
- An address must be in `allowed_emails` before a profile is created for it. A
  stranger who signs up gets an empty database, not your data.
- Every RLS policy requires a profile row, so access is decided by Postgres. A
  bug in a page can't leak what RLS wouldn't hand over.
- No `service_role` key anywhere in the app — only the anon key, which grants
  nothing on its own.
- Deletes are narrower than writes: for most tables the creator or an admin;
  for `companies`, admins only.
- Reads use `has_access()`, writes use `is_member()`. That is the viewer role,
  and it is enforced in Postgres, not in the UI: the hidden buttons are a
  courtesy, the policy is the boundary.
- One `settings` row (`key = 'club'`) is readable without a session, because
  `/privacy` and `/terms` are public and name the club. **Nothing private may go
  in that row.** Every other key stays behind `has_access()`.
- Attachments live in a private Storage bucket. Reads go through a 60-second
  signed URL; the bucket must never be made public, or every signed agreement
  becomes readable by anyone who can guess a path.

Verified by impersonating each role against a live database: anonymous and
signed-in non-members get 0 rows on every table and are blocked from insert,
update, delete and self-adding to the allowlist. Auth unreachable fails closed.
Non-admins can't add members or change roles; the last admin can't be demoted.

**One real hole was found and fixed** (migration 006). `profiles_self_update`
allowed a member to update any column on their own row, including `role` — so
"change your display name" also meant "make yourself admin", in one statement.
RLS has no per-column granularity, so the fix is column privileges plus a
`SECURITY DEFINER` `set_member_role()` that checks `is_admin()`.

---

## Map and geocoding

Pins are placed at **city** level by default. `geocache` holds one row per place
name; `companies.latitude/longitude` are copied from it. Regenerate with
`scripts/geocode_cities.py`, load into `geocache`, then:

```sql
update companies c set latitude = g.latitude, longitude = g.longitude
from geocache g where g.place = c.city;
update companies set area = ez_area(latitude, longitude) where latitude is not null;
```

New companies have no coordinates until that runs, so they won't appear on the
map. Rows whose city is a placeholder can never be placed.

`companies.geo_precision` distinguishes a real street location from a town
centre, and the map renders them differently (solid vs faded). Street-level
geocoding is **not currently working** — free text matched poorly and structured
queries matched worse. Only town centres are populated.

---

## Data and privacy

No company data is committed; `data/` and `*.csv` / `*.tsv` / `*.xlsx` are
gitignored. Supabase is the source of truth, and Import/Export produces a CSV
whenever you want one.

If a repo was ever public with data committed, remember **git keeps deleted
files in history** — making the repo private is the simple fix; rewriting
history with `git-filter-repo` is the thorough one.

---

## Testing without a database

There is no seed script and no test suite. What has worked repeatedly is a
throwaway stand-in for `lib/supabase.ts`: an in-memory fake implementing enough
of the PostgREST builder (`eq`, `is`, `not`, `in`, `or`, `ilike`, `order`,
`limit`, `range`, `count`, `maybeSingle`) plus a pass-through `middleware.ts`,
run against `npm run dev`. It renders every page with fabricated data and no
network, which is how the UI in this app has been checked.

Two things it cannot do, both of which have hidden a real bug at least once:

- **Triggers.** Anything the database does — audit rows, the committed gate, the
  reporting-loop guard — is invisible to the fake. Test those against the real
  project inside a `do $$ ... raise exception 'TEST >> %' $$` block, which
  reports what happened and rolls the whole thing back.
- **Nested PostgREST filters.** `or(and(...),and(...))` is beyond the fake's
  parser, so a filter using it looks like it matches everything. Check the
  syntax by sending it to the real REST endpoint with the anon key: 200 means
  PostgREST parsed it (RLS returns nothing), 400 means the string is wrong.

---

## Tooling notes

- The Supabase MCP connector is the fastest way to inspect or change state
  (`execute_sql`, `apply_migration`, `get_advisors`). Run `get_advisors` after
  any DDL — it catches missing RLS and mutable `search_path`.
- Supabase **auth config is not queryable**. Site URL and the redirect allowlist
  must be changed in the dashboard. To check what's set without sending an
  email, request the verify endpoint with a bogus token and read the `Location`
  header — where it sends a non-allowlisted URL reveals the Site URL.
- To verify UI that sits behind auth locally, temporarily add a path to `PUBLIC`
  in `middleware.ts`, render a throwaway page, then **revert both**.
