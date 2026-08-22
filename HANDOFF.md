# EZcrm — Handoff

State as of **2026-08-22**. Read this first if you're picking the project up
cold. [SETUP.md](SETUP.md) covers installation from scratch; this covers where
things actually stand and what bites. The in-app **/guide** page is the user
manual — this file is for whoever maintains the code.

---

## One-line summary

Live and working. Both members can sign in, 1,263 companies are loaded, mapped,
and de-duplicated. **Nobody has worked a single company yet** — 0 assigned,
0 contacted, 0 activities, 0 tasks. The next milestone is real usage, not more
features.

---

## Coordinates

| Thing | Value |
| --- | --- |
| Live app | **https://ksusmecrm.vercel.app** |
| Old alias | `e-zcrm.vercel.app` (307s to the above; don't share) |
| GitHub | https://github.com/siddharthsanghavi/EZcrm — **still PUBLIC** |
| Supabase | project `SMECRM`, ref `hhxwflceupkphishfbbo`, ca-central-1 |
| Vercel team slug | `sid-8952` |
| Branch | `main` |

No company data lives in the repo; Supabase is the source of truth and `data/`
is gitignored. The deleted CSVs remain in git *history* — making the repo
private is the simple fix (see "Purging data from history").

---

## Outstanding, roughly in priority order

1. **Nobody has used the CRM.** 1,263 companies, none assigned or contacted.
   Everything below matters less than getting twenty companies worked.
2. **Email rate limit.** Supabase's built-in sender allows a handful per hour
   and isn't meant for production. Fix with custom SMTP — Gmail
   (`smtp.gmail.com:587` + a Google App Password) sends to anyone; Resend needs
   a verified domain first.
3. **Magic-link template still uses the PKCE link.** `/auth/confirm` exists and
   works; point the template at
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` and
   links will work from any browser. Without it, opening a link in a mail app's
   in-app browser fails with a PKCE verifier error.
4. **Import / Export has never been run.** The 1,263 companies were loaded by
   SQL. It's untested code you'll first exercise under pressure.
5. **Street-level geocoding is parked.** Every pin is at its town centre. Free
   text got ~44%; structured Nominatim queries returned 0/50, which is worse
   than useless. The map already distinguishes precise from approximate pins
   (solid vs faded), so it'll light up if addresses ever land.
6. **Repo is public.** Make it private when convenient.

---

## Current state

```sql
select
  (select count(*) from companies)                            as companies,
  (select count(*) from companies where owner_id is not null) as assigned,
  (select count(*) from companies where status <> 'prospect') as worked,
  (select count(*) from activities)                           as activities,
  (select count(*) from tasks)                                as tasks,
  (select count(*) from profiles)                             as members;
```

At writing: 1,263 companies (1,247 geocoded, 23 Tier 1), 0 assigned, 0 worked,
0 contacts/activities/tasks, 2 members (both signed in, one admin).

---

## What exists

**Pages** — Dashboard, Companies (filter by tier/type/region/owner/status,
search, 50/page, bulk assign + bulk status), Company detail (status, owner,
activity timeline, contacts, tasks, status history), Pipeline (live flowchart +
who owns what), Map, Contacts, Tasks, Import/Export, Members, Guide.

**Behaviour worth knowing**

- `status_events` records every status change with who and when, via an
  `AFTER UPDATE` trigger — so bulk updates and raw SQL are captured too.
- `companies.area` is a computed region (12 of them, nearest-anchor from
  coordinates). The original `region` column is **unusable** for grouping —
  ~300 rows hold industry tags like `GA / Rubber & Plastics`.
- The map swaps layers at zoom 9: region bubbles below, individual companies
  above, declustering fully at 13.
- `/guide` renders `lib/changelog.ts`. **Add an entry there in the same commit
  as any user-visible change** — otherwise the guide silently goes stale.

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
`full_name` only. Role changes must go through `set_member_role()`. A plain
`update profiles set role = …` from the app will be denied — that's deliberate,
see migration 006 and "Security" below.

**`NEXT_PUBLIC_*` is inlined at build time.** Saving env vars in Vercel does
nothing to the live deployment. Redeploy with build cache disabled.

**Vercel preview URLs are SSO-walled.** `ksusmecrm-<hash>-sid-8952.vercel.app`
redirects to `vercel.com/sso-api`. Only share the clean domain. Signing in from
a preview URL also fails, because the callback host won't match Supabase's
allowlist.

**A 100% success rate can hide an 8% error rate.** Geocoding returned 227/227
hits and looked perfect; 19 towns were wrong by up to 434km, because Georgia has
counties sharing names with unrelated towns and free-text lookup preferred the
county. Always validate results against a bounding box, not just a hit count.

**`next dev` and `next build` fight over `.next/`.** Building while dev runs
corrupts it. Stop dev, delete `.next`, restart.

**Stale dev servers hide on port 3001.** If 3000 is taken Next silently uses
3001, so you verify a server the user isn't looking at. Kill all node processes
and confirm the port.

**The repo lives in OneDrive.** Sync corrupts `node_modules/` and `.next/`
mid-write. Moving to `C:\Git\EZcrm` is still recommended and still not done.

---

## Security

Verified by impersonating each role against the live database:

- Anonymous and signed-in non-members: 0 rows on every table; insert, update,
  delete and self-adding to the allowlist all blocked.
- Fails closed — with auth unreachable, every protected route redirects to login.
- Supabase security advisor: 0 findings.
- Non-admins cannot add members or change roles; the last admin cannot be
  demoted.

**One real hole was found and fixed** (migration 006). `profiles_self_update`
allowed a member to update any column on their own row, including `role` — a
member could make themselves admin in one statement. RLS has no per-column
granularity, so the fix is column privileges plus a `SECURITY DEFINER`
`set_member_role()` that checks `is_admin()`. If you ever re-grant blanket
`UPDATE` on `profiles`, you reopen this.

---

## Map and geocoding

Pins are at **city** level. `geocache` holds one row per place name;
`companies.latitude/longitude` are copied from it. Regenerate with
`scripts/geocode_cities.py` (structured city queries — do not use free text),
load into `geocache`, then:

```sql
update companies c set latitude = g.latitude, longitude = g.longitude
from geocache g where g.place = c.city;
update companies set area = ez_area(latitude, longitude) where latitude is not null;
```

New companies have no coordinates until that runs, so they're missing from the
map. 16 rows are permanently unplottable — their city is literally `(verify)` or
`Multiple GA`.

---

## Purging data from history

`data/` was removed from the working tree, but git keeps deleted files in
history, and on a public repo the old CSVs stay fetchable at their previous
commits.

Simplest fix: **make the repo private**. To actually erase them — destructive,
rewrites every hash, everyone must re-clone:

```bash
pipx run git-filter-repo --path data/ --invert-paths --force
```

Then force-push. The original spreadsheet was never committed; only derived
CSV/TSV files are involved.

---

## Tooling notes

- **Supabase MCP works** and is the fastest way to inspect or change state —
  `execute_sql`, `apply_migration`, `get_advisors`.
- **Vercel MCP cannot see this project.** `list_projects` returns `[]` for the
  team. Diagnose Vercel from outside with `curl`.
- **Supabase auth config is not queryable.** Site URL and the redirect allowlist
  must be changed in the dashboard. To check what's configured without sending
  an email, probe the verify endpoint with a bogus token and read the
  `Location` header — where it sends a non-allowlisted URL reveals the Site URL.
- Verifying UI behind auth locally: temporarily add a path to `PUBLIC` in
  `middleware.ts`, render a throwaway page, then **revert both**.

---

## Next actions

1. Assign 20 Tier 1 companies and actually contact them.
2. Configure custom SMTP.
3. Point the magic-link template at `/auth/confirm`.
4. Exercise Import / Export with a small CSV.
5. Make the repo private.
6. Move the working copy out of OneDrive.
