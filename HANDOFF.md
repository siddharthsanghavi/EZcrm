# EZcrm — Handoff

State of play as of **2026-08-21**. Read this first if you're picking the project
up cold. [SETUP.md](SETUP.md) covers installation; this covers *where things
actually stand and what bites*.

---

## The one-line summary

Live, working, and in use. Sign-in works, 1,263 companies are loaded and mapped.
The main outstanding risk is the email rate limit when onboarding teammates.

---

## Coordinates

| Thing | Value |
| --- | --- |
| Live app | **https://ksusmecrm.vercel.app** |
| Old alias | `e-zcrm.vercel.app` (307s to the above; do not share) |
| GitHub | https://github.com/siddharthsanghavi/EZcrm — **currently PUBLIC** |
| Supabase project | `SMECRM`, ref `hhxwflceupkphishfbbo`, region `ca-central-1` |
| Supabase URL | `https://hhxwflceupkphishfbbo.supabase.co` |
| Vercel team slug | `sid-8952` |
| Branch | `main` — clean, pushed, in sync |

**Company data is no longer in the repo.** Supabase is the single source of
truth (1,263 companies); `data/` is gitignored.

The repo is still **public**, and the deleted CSVs remain in git *history* — see
"Purging data from history" below.

---

## Outstanding

1. **Email rate limit.** Supabase's built-in sender allows only a handful per
   hour and is not meant for production. With five members requesting links this
   will bite. Fix with custom SMTP: Gmail (`smtp.gmail.com:587` + a Google App
   Password) sends to anyone; Resend needs a verified domain first.
2. **One teammate has not completed sign-in.** `val.93002@gmail.com` has an
   account and a profile but `last_sign_in_at` is null — their original link was
   consumed while Site URL still pointed elsewhere. They just need a fresh link.
3. **Email template still uses the PKCE link.** `/auth/confirm` exists and works;
   pointing the Magic Link template at
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` makes
   sign-in work from any browser. Without it, opening a link in a mail app's
   in-app browser fails with a PKCE verifier error.
4. **Import / Export page has never been exercised** — the 1,263 companies were
   loaded by SQL, not through the UI.

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

As of writing: 2 auth users (1 has signed in), 2 profiles, 3 allowlisted,
**1,263 companies** (1,247 geocoded), 0 contacts/activities/tasks.

The owner is already `role = 'admin'`. To promote someone else:

```sql
update profiles set role = 'admin' where email = 'teammate@club.org';
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
- **Production is public** — no Vercel login wall on `ksusmecrm.vercel.app`;
  protected routes redirect to `/login`.
- **CSV pipeline** — the real 1,294-row file was replayed through the exact
  parser and mapping code: 0 parse errors, 0 skipped, all 13 fields mapped,
  multi-line notes surviving quoting. 493 KB payload, well under Vercel's limit.
- **Typecheck and production build** pass clean, 14 routes.

## What is NOT verified

Sign-in, the dashboard, the company list and the map are all confirmed working
against real data. Still unexercised: **logging activity, creating tasks, adding
contacts, and the Import / Export page**. Expect first-run bugs there.

---

## Purging data from history

`data/` was removed from the working tree, but **git keeps deleted files in
history**. On a public repo the old CSVs stay fetchable at their previous
commits, and GitHub may serve them for a while even after a rewrite.

Simplest fix: **make the repo private** (Settings → General → Change visibility).
That ends public access without touching history.

To actually erase them — destructive, rewrites every commit hash, and everyone
must re-clone:

```bash
pipx run git-filter-repo --path data/ --invert-paths --force
```

Then `git push --force origin main`. Only worth it if the repo must stay public
AND the list must be secret. Note the original spreadsheet was never committed,
so only the derived CSV/TSV files are involved.

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

**Vercel preview URLs are SSO-walled.** `ksusmecrm-<hash>-sid-8952.vercel.app`
redirects to `vercel.com/sso-api` — anyone you share it with is asked to log into
*your* Vercel account. Only share `https://ksusmecrm.vercel.app`. Signing in from a
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

1. Configure **custom SMTP** so the email limit stops interfering.
2. Point the **Magic Link email template** at `/auth/confirm` (see above).
3. Get the remaining teammates signed in.
4. Exercise the untested paths: log an activity, add a task, add a contact, and
   run a small CSV through Import / Export.
5. Make the GitHub repo **private**.
6. Move the working copy out of OneDrive.
