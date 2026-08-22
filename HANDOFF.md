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
`saved_views`, plus `profiles` and `allowed_emails` for access, `geocache` for
map coordinates, and `auth_email_requests` / `login_events` for sign-in
tracking (both admin-read-only, both revoked from `anon`).

**Pages** — Dashboard, Companies (filters, search, pagination, bulk assign and
bulk status), Company detail (status, owner, activity timeline, contacts, tasks,
status history), Pipeline (live flowchart), Map, Contacts, Tasks, Import/Export,
Members, Guide.

**Behaviour worth knowing**

- `status_events` records every status change with who and when, via an
  `AFTER UPDATE` trigger — so bulk updates and raw SQL are captured too, not
  just the UI.

- `companies.last_touch_at` and `contacts.last_touch_at` are maintained the same
  way, by an `AFTER INSERT` trigger on `activities`. Use these — **not
  `updated_at`** — to judge whether anyone has actually been in contact;
  `updated_at` moves when someone fixes a typo. The trigger refuses to move a
  touch backwards, so back-dating an old call can't make a company look colder.

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
  replace it for your own geography.
- The map swaps layers at zoom 9: region bubbles below, individual companies
  above, declustering fully at 13.
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
- Deletes are narrower than writes: any member can edit, only the creator or an
  admin can delete.

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
