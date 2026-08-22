# EZcrm — Setup Guide

Everything needed to get EZcrm running on a new machine, from nothing to a
deployed app. Do the parts in order — Part E needs a URL that Part D produces.

**Time:** ~30 minutes, mostly waiting on installs and Supabase provisioning.

---

## What this is

A lightweight CRM for a club running outreach to companies for **tours and
sponsorships**. Tracks companies, the people at them, every touch, and what you
owe them next.

Built for ~5 users on free tiers, with access control enforced in the database
(Postgres row-level security) rather than in application code.

| Piece | Choice | Cost |
| --- | --- | --- |
| App | Next.js 15 (App Router) on Vercel | Free (Hobby) |
| Database | Supabase Postgres | Free (500 MB) |
| Auth | Supabase magic links | Free |

500 MB holds hundreds of thousands of contacts. You will not outgrow it.

---

## Part A — Install the toolchain

**Windows**

```bash
winget install OpenJS.NodeJS.LTS Git.Git
```

**macOS**

```bash
brew install node git
```

**Linux (Debian/Ubuntu)**

```bash
sudo apt update && sudo apt install -y nodejs npm git
```

**Close and reopen your terminal** so `node` lands on your PATH, then confirm —
you want Node 18 or newer:

```bash
node -v && npm -v && git --version
```

> **Optional:** the CSV converter in `scripts/` needs Python 3 with `openpyxl`.
> You only need it to convert a new spreadsheet into importable CSVs. Output
> goes to `data/`, which is gitignored, so converted files never reach GitHub.
>
> ```bash
> pip install openpyxl
> ```

---

## Part B — Get the code

```bash
git clone <your-fork-url>
```

> ⚠️ **Do not clone into OneDrive, Dropbox, or iCloud.** Sync services corrupt
> `node_modules/` and `.next/` mid-write, producing baffling failures like
> `invalid distance code` and phantom missing modules. Use `C:\Git\` or
> `~/code/` instead. This has already bitten this project once.

```bash
cd EZcrm && npm install
```

---

## Part C — Set up Supabase

### 1. Create the project

1. Sign up at [supabase.com](https://supabase.com) → **New project**.
2. **Name:** `ezcrm` · **Region:** closest to your club · **Plan:** Free.
3. **Database password:** generate one and save it in your password manager.
   You won't need it for this app, but it's unrecoverable.
4. On the creation screen:
   - **Enable Data API** — leave **ON**. This is how the app reaches the database.
   - **Automatically expose new tables** — leave **ON**. RLS does the gating, not
     table exposure. Turn it off and your tables become unreachable.
   - **Enable automatic RLS** — turn **ON**. Safety net so a future table can't
     sit world-readable because someone forgot a line.
   - **Postgres Type** — keep the default **Postgres**. OrioleDB is alpha and the
     choice is permanent.

Provisioning takes ~2 minutes.

### 2. Run the schema

Dashboard → **SQL Editor** → **New query**. Paste all of
[`supabase/schema.sql`](supabase/schema.sql) and run it. Expect
*"Success. No rows returned."*

That one file creates all six tables, the RLS policies, the allowlist trigger,
and the function grants. Nothing else to run on a fresh project.

> **Upgrading a database created before the directory import?** Run the files in
> [`supabase/migrations/`](supabase/migrations/) in numeric order. They're all
> written to be safe to re-run.

### 3. Put yourself on the allowlist

Nobody can enter until their address is in `allowed_emails`:

```sql
insert into allowed_emails (email, note) values ('you@example.com', 'admin');
```

### 4. Copy your credentials

Supabase → **Project Settings** → **API**. You need the **Project URL** and the
**anon public** key.

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Optional. Any random string. Enables per-IP capping of sign-in link requests
# on top of the club-wide hourly limit. Without it, IP addresses aren't recorded
# at all — a plain hash of an IP is reversible by brute force, so storing one
# unsalted would be storing the address in a thin disguise.
AUTH_RATE_SALT=
```

> ⚠️ **Never put the `service_role` key in this project.** It bypasses every RLS
> policy, and anything prefixed `NEXT_PUBLIC_` is shipped to the browser. The
> anon key grants nothing on its own — that's the entire design.

### 5. Run it

```bash
npm run dev
```

Open <http://localhost:3000>, enter your allowlisted email, click the link in
your inbox.

### 6. Make yourself an admin

Only works **after** your first sign-in — that's when the profile row is created.

```sql
update profiles set role = 'admin' where email = 'you@example.com';
```

Admin lets you delete records you didn't create and manage the allowlist.

---

## Part D — Deploy to Vercel

1. Push the code if you haven't:

   ```bash
   git push -u origin main
   ```

2. [vercel.com](https://vercel.com) → sign in with GitHub → **Add New → Project**
   → import `EZcrm`. It auto-detects Next.js; change nothing in build settings.

3. **Before deploying**, add both environment variables — same values as
   `.env.local`:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | your project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |
   | `AUTH_RATE_SALT` | optional; any random string (see above) |

4. **Deploy**, then copy your URL (`https://ezcrm-something.vercel.app`).

---

## Part E — Point Supabase at your deployment

**This is the step people miss.** Magic links silently fail without it.

Supabase → **Authentication** → **URL Configuration**:

- **Site URL:** `https://ezcrm-something.vercel.app`
- **Redirect URLs:** add **both**
  - `https://ezcrm-something.vercel.app/auth/callback`
  - `http://localhost:3000/auth/callback`

Keeping the localhost entry means you can still develop locally.

---

## Importing the company directory

`schema.sql` creates empty tables — no company data is committed to this repo.
Load your own list through **Import / Export → Companies**, and export a CSV from
the same page whenever you want a copy.

In the app: **Import / Export** → **Companies** → choose the CSV → review the
preview → **Import**. Re-importing is safe — companies whose name already exists
are skipped, so pulling in the full file later adds only the ones you don't have.

### Regenerating from a new spreadsheet

```bash
python scripts/convert_directory.py path/to/directory.xlsx
```

Reads only the **All Companies** sheet — the per-type sheets are strict subsets,
so importing those too would just create duplicates. Maps Type, City, Region,
Address, Phone, Confidence tier, and Employees into real filterable columns, and
seeds `interest` from company type (large manufacturers → tour targets,
automation firms → sponsorship targets). All editable per company afterwards.

---

## Adding club members

One SQL line each — no invites, no seats, no billing:

```sql
insert into allowed_emails (email, note) values
  ('teammate1@club.org', 'outreach'),
  ('teammate2@club.org', 'outreach');
```

They sign in at your Vercel URL and they're in.

**To remove someone,** delete from **both** tables — the first gates signup, the
second gates access:

```sql
delete from profiles where email = 'former@club.org';
delete from allowed_emails where email = 'former@club.org';
```

---

## Security model

- **Magic-link sign-in.** No passwords stored, so there are no passwords to leak.
- **Allowlist.** An address must be in `allowed_emails` before a profile is
  created for it. A stranger who signs up sees an empty database.
- **Row-level security.** Every policy requires a profile row. Access is decided
  by Postgres, so a bug in a page can't leak data RLS wouldn't have handed over.
- **No service-role key.** The app only ever holds the anon key. No credential in
  this repo can bypass RLS.
- **Deletes are narrower than writes.** Any member can edit; only the record's
  creator or an admin can delete.
- **Headers** — HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions
  policy, set in `next.config.mjs`.
- **CSV injection guarded** — exported cells starting with `=`, `+`, `-`, or `@`
  are prefixed so they can't execute as formulas in Excel.

Encryption in transit and at rest comes from Supabase and Vercel by default.

### Verified against the live database

Run against a real Supabase project with a seeded row, impersonating each role:

| Attack | Result |
| --- | --- |
| Anonymous reads `companies` | 0 rows |
| Anonymous inserts a company | Blocked |
| Signed-in non-member reads any table | 0 rows across all six |
| Signed-in non-member inserts a company | Blocked |
| Signed-in non-member adds self to allowlist | Blocked |
| Signed-in non-member updates / deletes companies | 0 rows affected |
| Unreachable auth backend | Every protected route redirects to login (fails closed) |
| Supabase security advisor | 0 findings |

### A note on `is_member()` / `is_admin()`

Supabase's linter flags these as publicly callable RPC endpoints. **They must
keep their `EXECUTE` grant** — RLS policy evaluation runs as the querying role,
so revoking it makes every member query fail with
`permission denied for function is_member` instead of returning rows. (Learned
the hard way; don't "fix" this warning.)

The exposure is acceptable: both take no arguments and report only whether *the
caller* is a member or admin. They disclose nothing about anyone else, and the
answer is already implied by whether the caller's queries return rows.

`handle_new_user()` and `touch_updated_at()` are trigger-only and **do** have
`EXECUTE` revoked.

---

## Project layout

```
app/
  (app)/            Authenticated pages — dashboard, companies, contacts, tasks, import
  api/              CSV import + export routes
  auth/             Magic-link callback and sign-out
  actions.ts        Server actions (all database writes)
  login/            Public sign-in page
components/         Forms, activity composer, task rows, CSV importer
lib/
  supabase.ts         Server client + currentProfile()  (marked server-only)
  supabase-browser.ts Browser client  (never imports next/headers)
  types.ts            Shared types, statuses, tiers
supabase/
  schema.sql        Full schema + RLS policies — run this first
  migrations/       Incremental changes for existing databases
scripts/            XLSX to CSV converter
data/               Converted CSVs (gitignored — never committed)
middleware.ts       Session refresh + route protection
```

**The two Supabase modules are deliberately separate.** `lib/supabase.ts` imports
`next/headers` and is marked `server-only`; importing it from a Client Component
is a build error rather than a silent failure. Client Components use
`lib/supabase-browser.ts`. Merging them breaks every page with a 500 — this
already happened once.

---

## Day-to-day use

- **Companies** — the main list. Filter by tier, type, region, status; search by
  name, city, or specialty. Sorted Tier 1 first, 50 per page.
- **Company detail** — status dropdown, activity timeline, contacts, and tasks on
  one page.
- **Dashboard** — status counts, open tasks, recent activity, and a **"going
  cold"** list: companies in an active stage with no touch in three weeks. Those
  are the ones that quietly die.
- **Import / Export** — CSV in and out. Your data is never locked in.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `"Failed to fetch"` on login | `.env.local` still has placeholder values, or the dev server wasn't restarted after editing it. |
| Magic link goes nowhere, or redirects to localhost from your phone | Part E not done — add the callback URL to Supabase's redirect allowlist. |
| Signed in but see "Not on the roster" | Your email isn't in `allowed_emails`. Add it, then sign in again. |
| `permission denied for function is_member` | Someone revoked `EXECUTE` on it. Re-grant: `grant execute on function is_member() to anon, authenticated;` |
| Queries return empty for a table you just created | Automatic RLS enabled it with no policies. Write one — copy the `do $$ … $$` block at the bottom of `schema.sql`. |
| First load after a quiet week takes ~10s | Supabase pauses free projects after ~7 days idle. Opening the app resumes it. |
| Magic-link emails slow or missing | Supabase's built-in sender is rate-limited to a few per hour. Connect a free [Resend](https://resend.com) account under **Authentication → Emails → SMTP Settings**. |
| `invalid distance code`, phantom missing modules | The project is in a synced folder (OneDrive/Dropbox). Move it out. |
| Dev server 500s right after `npm run build` | `next dev` and `next build` fight over `.next/`. Stop the dev server, delete `.next/`, restart. |

---

## Commands

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run typecheck
```

---

## Free-tier caveats

- Supabase pauses free projects after ~1 week of no requests; opening the app
  resumes it in a few seconds. Regular use means you'll never see this.
- Supabase's built-in email sender is rate-limited. Fine for five people; swap in
  Resend SMTP if links start lagging.
- Vercel's Hobby plan is for non-commercial use. A student club qualifies.
