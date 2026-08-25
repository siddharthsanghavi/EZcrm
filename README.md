# EZcrm

A lightweight CRM for a club running outreach to companies for tours and sponsorships.
Tracks companies, the people at them, every touch, and what you owe them next.

Built for ~5 people, on free tiers, with security enforced in the database rather
than in application code.

> **Picking this up cold?** Read [HANDOFF.md](HANDOFF.md) first — it records
> current state, the outstanding blockers, and the traps that have already cost
> time. [SETUP.md](SETUP.md) covers installing from scratch.
>
> **Want one of these for your own group?** Start with
> [MAKE-IT-YOURS.md](MAKE-IT-YOURS.md). It lists exactly what is stitched to this
> club, this state, and this kind of company — and what to change so it stops
> being someone else's app.

## Stack

| Piece | Choice | Cost |
| --- | --- | --- |
| App | Next.js (App Router) on Vercel | Free (Hobby) |
| Database | Supabase Postgres | Free (500MB) |
| Auth | Supabase magic links | Free |

500MB holds hundreds of thousands of contacts. You will not outgrow it.

## Security model

- **Magic-link sign-in.** No passwords stored, so there are no passwords to leak.
- **Allowlist.** An address must be in `allowed_emails` before a profile exists for
  it. Sign-ups from outside the club land on a dead end with an empty database.
- **Row-level security.** Every policy requires a profile row. Access is decided by
  Postgres, so a bug in a page can't leak data that RLS wouldn't have handed over.
- **No service-role key.** The app only ever holds the anon key, which grants
  nothing on its own. There is no credential in this repo that can bypass RLS.
- **Deletes are narrower than writes.** Any member can edit; only the record's
  creator or an admin can delete.
- HSTS, `X-Frame-Options: DENY`, and `nosniff` are set in `next.config.mjs`.
  Encryption in transit and at rest comes from Supabase and Vercel by default.

## Setup

### 1. Install Node

```bash
winget install OpenJS.NodeJS.LTS
```

Close and reopen your terminal afterwards so `node` lands on your PATH.

### 2. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a free project.
   Pick the region closest to your club.
2. Open the **SQL Editor**, paste the whole of `supabase/schema.sql`, and run it.
3. At the bottom of that file, uncomment the `insert into allowed_emails` line
   with your own address and run it. Repeat for each club member.

### 3. Configure and run

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill in both values from
**Supabase → Project Settings → API**, then:

```bash
npm run dev
```

Visit http://localhost:3000, sign in with an allowlisted address, then make
yourself an admin in the SQL editor:

```sql
update profiles set role = 'admin' where email = 'you@example.com';
```

### 4. Deploy

Push to GitHub, import the repo at [vercel.com](https://vercel.com), and add the
same two environment variables. Then in **Supabase → Authentication → URL
Configuration**, set the site URL to your Vercel domain and add
`https://your-app.vercel.app/auth/callback` to the redirect allowlist — magic
links won't work until you do.

## Getting your data in

No company data lives in this repo — Supabase is the single source of truth and
`data/` is gitignored. Load your own list through **Import / Export**, and export
a CSV from the same page whenever you want a copy.

### Importing a new list

Go to **Import / Export**, pick **Companies**, choose a CSV, review the preview,
and import. Companies whose name already exists are skipped, so re-importing tops
up rather than duplicating.

To convert a spreadsheet first:

```bash
python scripts/convert_directory.py path/to/directory.xlsx
```

It writes CSVs to `data/`, which is gitignored — convert, import, and the files
stay off GitHub.

## Adding club members

```sql
insert into allowed_emails (email, note) values ('member@club.org', 'outreach team');
```

They sign in at the login page and are in. To remove someone, delete their row
from `allowed_emails` **and** from `profiles` — the allowlist gates signup, the
profile gates access.

## Day-to-day

- **Companies** is the main list; each one has a status from Prospect through
  Committed, and a timeline of everything you've done.
- **Dashboard** surfaces companies in an active stage with no touch in three
  weeks — the ones most likely to quietly die.
- **Import / Export** takes a CSV of companies or contacts, and gives everything
  back as CSV whenever you want it.

## Free-tier caveats

- Supabase pauses a free project after ~1 week of no requests. Opening the app
  resumes it (takes a few seconds). Regular use means you'll never see this.
- Supabase's built-in email sender is rate-limited and can be slow. For a
  five-person club it's fine; if links start lagging, connect a free Resend
  account under **Authentication → Emails → SMTP Settings**.
- Vercel's Hobby plan is for non-commercial use. A student club qualifies.
