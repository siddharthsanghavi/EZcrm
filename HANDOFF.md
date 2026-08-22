# EZcrm — Handoff

State of play as of **2026-08-20**. Read this first if you're picking the project
up cold. [SETUP.md](SETUP.md) covers installation; this covers *where things
actually stand and what bites*.

---

## The one-line summary

The app is built, deployed, and publicly reachable. **Nobody has ever completed
a sign-in.** One dashboard setting is blocking it.

---

## Coordinates

| Thing | Value |
| --- | --- |
| Live app | https://e-zcrm.vercel.app |
| GitHub | https://github.com/siddharthsanghavi/EZcrm |
| Supabase project | `SMECRM`, ref `hhxwflceupkphishfbbo`, region `ca-central-1` |
| Supabase URL | `https://hhxwflceupkphishfbbo.supabase.co` |
| Vercel team slug | `sid-8952` |
| Branch | `main` — clean, pushed, in sync |

Commits so far:

```
69931c9  Surface why sign-in failed instead of silently bouncing to /login
1f873a9  Fail legibly when Supabase env vars are missing
470362a  EZcrm: club outreach CRM for tours and sponsorships
```

---

## BLOCKER — do this first

**Supabase Site URL is still `http://localhost:3000`.**

Every magic link therefore redirects to localhost instead of the live app. This
is the entire reason sign-in has never succeeded.

Fix at **Authentication → URL Configuration**
([link](https://supabase.com/dashboard/project/hhxwflceupkphishfbbo/auth/url-configuration)):

- **Site URL:** `https://e-zcrm.vercel.app`
- **Redirect URLs:** `https://e-zcrm.vercel.app/auth/callback`
  (optionally also `http://localhost:3000/auth/callback` for local dev)

There is **no API for this** — Supabase exposes no auth-config endpoint, and the
Vercel MCP connector cannot see this project. It must be clicked by the owner.

If a redirect URL isn't on the allowlist, Supabase does not error — it silently
falls back to Site URL. That silent fallback burned several hours.

---

## Second blocker — email rate limit

Supabase's built-in email sender is throttled to a handful per hour and is
explicitly not for production. With ~5 members requesting links, this will be
hit constantly.

**Fix before onboarding anyone:** Authentication → Emails → SMTP Settings →
Enable Custom SMTP.

- **Resend** — 3,000/month free, but until a domain is verified it can only send
  to the account owner's own address. Only viable if the club has a domain.
- **Gmail SMTP** — `smtp.gmail.com:587`, username = the Gmail address, password =
  a Google **App Password** (needs 2-Step Verification). Sends to anyone,
  ~500/day. Realistically the right call for a student club.

---

## Current database state

Verify with:

```sql
select
  (select count(*) from auth.users)                                   as auth_users,
  (select count(*) from auth.users where last_sign_in_at is not null) as ever_signed_in,
  (select count(*) from public.profiles)                              as profiles,
  (select count(*) from public.allowed_emails)                        as allowlisted,
  (select count(*) from public.companies)                             as companies;
```

As of writing: 1 auth user, **0 ever signed in**, 1 profile, 3 allowlisted,
0 companies/contacts/activities/tasks.

The single profile is `role = 'member'`. To make the owner an admin (needed to
delete others' records and manage the allowlist):

```sql
update profiles set role = 'admin' where email = 'siddharth.sanghavi.360@gmail.com';
```

---

## What is verified working

- **Schema + RLS** — all 6 tables, 19 policies, RLS enabled on every one.
- **Live attack tests** against the real database, impersonating each role:
  anonymous and signed-in non-members get 0 rows on every table, and are blocked
  from insert, update, delete, and self-adding to the allowlist. A seeded canary
  row survived all of it.
- **Allowlist trigger works** — a real signup produced a `profiles` row.
- **Supabase security advisor: 0 findings.**
- **Fails closed** — with auth unreachable, every protected route redirects to
  login rather than rendering.
- **Production is public** — no Vercel login wall on `e-zcrm.vercel.app`;
  protected routes redirect to `/login`.
- **CSV pipeline** — the real 1,294-row file was replayed through the exact
  parser and mapping code: 0 parse errors, 0 skipped, all 13 fields mapped,
  multi-line notes surviving quoting. 493 KB payload, well under Vercel's limit.
- **Typecheck and production build** pass clean, 14 routes.

## What is NOT verified

Everything behind a session. **No one has ever been signed in**, so the
dashboard, company pages, activity logging, tasks, and the actual import have
never run against real data. Expect first-run bugs there.

---

## Map and geocoding

Companies are plotted at **city** level, not street address. `geocache` holds one
row per place name; `companies.latitude/longitude` are copied from it. Regenerate
with `scripts/geocode_cities.py`, load into `geocache`, then:

```sql
update companies c set latitude = g.latitude, longitude = g.longitude
from geocache g where g.place = c.city;
```

New companies get no coordinates until that runs, so they will be missing from
the map. 16 rows are permanently unplottable — their city is literally
`(verify)` or `Multiple GA`.

## Traps — each of these cost real time

**Vercel preview URLs are SSO-walled.** `e-zcrm-<hash>-sid-8952.vercel.app`
redirects to `vercel.com/sso-api` — anyone you share it with is asked to log into
*your* Vercel account. Only share `https://e-zcrm.vercel.app`. Signing in from a
preview URL also fails auth, because the callback host won't match Supabase's
allowlist.

**`NEXT_PUBLIC_*` is inlined at build time.** Saving env vars in the Vercel
dashboard does nothing to the live deployment. You must redeploy, with build
cache disabled.

**Never merge the two Supabase modules.** `lib/supabase.ts` imports
`next/headers` and is marked `server-only`; `lib/supabase-browser.ts` is for
Client Components. Merging them makes the login page pull `next/headers` into the
browser bundle → **500 on every route**. Already happened once.

**Do not revoke EXECUTE on `is_member()` / `is_admin()`.** Supabase's linter
flags them as publicly callable and it is tempting to "fix". RLS policy
evaluation runs as the querying role, so revoking breaks every member query with
`permission denied for function is_member`. Already happened once. The exposure
is harmless: they take no arguments and report only whether *the caller* is a
member. `handle_new_user()` and `touch_updated_at()` are trigger-only and
correctly have EXECUTE revoked.

**`next dev` and `next build` fight over `.next/`.** Running a build while the
dev server is up corrupts it and the dev server starts 500ing. Stop dev, delete
`.next`, restart.

**Stale dev servers hide on port 3001.** If 3000 is occupied, Next silently uses
3001 — so you end up verifying a server the user isn't looking at, while they
see an old build with old env vars. Kill all node processes and confirm the port
before trusting anything local.

**The repo lives in OneDrive.** Sync corrupts `node_modules/` and `.next/`
mid-write (`invalid distance code`, phantom missing modules). Moving to
`C:\Git\EZcrm` is still recommended and not yet done.

---

## Tooling notes for the next session

- **Supabase MCP works** and is the fastest way to inspect state — `execute_sql`,
  `list_tables`, `apply_migration`, `get_advisors`. Use it rather than guessing.
- **Vercel MCP cannot see this project.** `list_projects` returns `[]` for team
  `team_1U6JJpEHMcy59ONeUJYQpmHM`, and `get_deployment` 404s on both the alias
  and the preview host. Diagnose Vercel from the outside with `curl` instead.
  Running `npx vercel login` + `vercel link` would create `.vercel/project.json`
  and unlock API access — not done, requires interactive browser login.
- **Auth config is not queryable.** GoTrue settings live outside Postgres.
  `/auth/v1/settings` (with the anon key) shows providers and flow config but not
  Site URL or the redirect allowlist.
- Useful outside-in check — which Supabase host a deployment actually calls:

  ```bash
  curl -s https://e-zcrm.vercel.app/login | grep -oE '/_next/static/chunks/app/login/[^"]+\.js'
  ```

  then fetch that chunk and grep for `supabase.co`.

---

## Environment variables

Both are safe to hold in plain text — the anon key grants nothing on its own;
RLS does the gating. **Never introduce the `service_role` key**; it bypasses
every policy and the whole security model rests on them.

```
NEXT_PUBLIC_SUPABASE_URL=https://hhxwflceupkphishfbbo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Supabase → Settings → API>
```

Set in Vercel for **Production, Preview, and Development**, and locally in
`.env.local` (gitignored).

Note: `@supabase/ssr` is pinned at 0.5.2, which predates the newer
`sb_publishable_...` key format. Use the **legacy `anon` JWT**, or upgrade `ssr`
first.

---

## Next actions, in order

1. Set Supabase **Site URL** to `https://e-zcrm.vercel.app` *(blocker)*.
2. Configure **custom SMTP** so the email limit stops interfering.
3. Sign in at `https://e-zcrm.vercel.app` — confirm `last_sign_in_at` populates.
4. Promote the owner to `admin`.
5. Import `data/companies-priority.csv` (205 rows) via **Import / Export**, then
   `companies-all.csv` (1,294) once satisfied. Re-import is safe — existing names
   are skipped.
6. Exercise the authenticated paths for the first time: company detail, activity
   logging, tasks, filters, export.
7. Move the repo out of OneDrive.
