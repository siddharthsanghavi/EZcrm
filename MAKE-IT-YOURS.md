# Making EZcrm your own

This repo is one club's outreach tracker. It is deliberately small and
deliberately opinionated, and most of it will fit another group unchanged — but
some of it is stitched to *this* club, *this* state, and *this* kind of company,
and those parts will be wrong for you in ways that are not obvious until they
bite.

This guide is the list of what to change, in the order that matters, with the
exact files. [SETUP.md](SETUP.md) is how to get it running; this is how to stop
it being someone else's app.

---

## Is this the right starting point?

**It fits if** you are a small group (roughly 3–20 people) doing outreach to
organisations — student chapters chasing tours and sponsors, a nonprofit
courting partners, a research group tracking industry contacts. Everyone sees
everything, there is one shared pipeline, and the whole thing runs on free
tiers.

**It does not fit if** you need per-person private records, custom fields per
customer, multiple pipelines, quotas, or anything resembling sales forecasting.
Those are real CRM features and this deliberately has none of them. Use HubSpot's
free tier instead — genuinely, it will be less work than bending this.

**What it costs:** nothing. Supabase free tier (500 MB, ~50,000 monthly sign-ins),
Vercel Hobby, and free geocoding. 500 MB holds hundreds of thousands of contacts;
you will not outgrow it. The one real limit is described under *Sign-in* below.

---

## 1. Get it running first

Fork the repo, then follow [SETUP.md](SETUP.md) Parts A–E end to end. Do not
customise anything yet — get a working, deployed, signed-in-as-yourself app with
zero companies in it. Everything below is easier to reason about once you can see
it, and much easier to debug when only one thing has changed at a time.

---

## 2. Your vocabulary

**`lib/types.ts` is the single file that decides what this app is about.** Read
it top to bottom before changing anything else; it is short, and almost every
list in it is a judgement made for a manufacturing-outreach club.

| What | Line ~ | Currently | Change it if… |
| --- | --- | --- | --- |
| `STATUSES` | 10 | prospect → contacted → in conversation → committed, plus declined/dormant | your pipeline has different stages |
| `INTERESTS` | 61 | `tour`, `sponsorship` | **almost certainly** — this is what you're asking organisations *for* |
| `ACTIVITY_TYPES` | 64 | note, email, call, meeting, linkedin, other | rarely; this list travels well |
| `TIERS` | 68 | Tier 1–3, Reference | your source list ranks prospects differently |
| `ACTIVE_STAGES` | 154 | contacted, in conversation | you change `STATUSES` |
| `COLD_AFTER_DAYS` | 157 | `21` | three weeks is the wrong silence for your cycle |

Two things to know before you edit:

**`STATUSES` is mirrored in the database.** There is a `check` constraint on
`companies.status` in [`supabase/schema.sql`](supabase/schema.sql). Change the TS
array without changing the constraint and inserts fail at runtime, not at build.
Same for `ACTIVITY_TYPES` and `activities.type`.

**`TIERS` has a sort order baked in.** `companies.tier_rank` is a generated
column that maps each tier name to a number, because sorting `tier`
alphabetically puts "Reference" above "Tier 1" — exactly backwards. If you rename
tiers, update that `case` expression in `schema.sql` too or your default ordering
silently goes wrong.

If you change `STATUSES`, also look at `STATUS_LABELS`, `STATUS_STYLES` and
`STATUS_DOTS` in the same file — they are keyed by status and TypeScript will
tell you which ones you missed.

---

## 3. Your geography

**This is the part most likely to be quietly wrong for you.** Three places
assume the US state of Georgia.

**a. Region grouping** — [`supabase/migrations/005_map_grouping.sql`](supabase/migrations/005_map_grouping.sql)

`ez_area()` holds twelve anchor points and assigns each company to the nearest
one. That is what the map's zoomed-out bubbles group by, and what the `area`
column stores.

```sql
('Metro Atlanta',  33.7550, -84.3900),
('Northwest',      34.6000, -85.0000),
…
```

Replace the whole list with anchors for your own region — one row per grouping
you want, with a representative latitude and longitude. Then re-run it for
existing rows:

```sql
update companies set area = ez_area(latitude, longitude) where latitude is not null;
```

**b. The geocoder's sanity check** — [`supabase/functions/geocode/index.ts`](supabase/functions/geocode/index.ts)

```ts
const BBOX = { minLat: 30.30, maxLat: 35.05, minLon: -85.70, maxLon: -80.70 };
```

This rejects any geocode result outside Georgia. Leave it Georgia-shaped and
every one of your addresses is refused. Widen it to your area — but **do widen
it, don't delete it.** It exists because a geocoder returns a confident answer
even when it is wrong; a past run here reported a 100% hit rate while being
about 8% wrong, some by hundreds of kilometres.

**c. Where the map opens** — [`components/company-map.tsx`](components/company-map.tsx)

```ts
.setView([32.75, -83.4], 7)
```

Centre and zoom. Point it at your own region.

### If you are outside the US

The street-level geocoder is the **US Census Bureau**, which only covers US
addresses. Everything else works, but `supabase/functions/geocode` will match
nothing. Options, best first:

- **[Nominatim](https://nominatim.openstreetmap.org)** — free, worldwide, no key.
  `scripts/geocode_cities.py` already uses it for town-level lookups; adapt that
  rather than the Edge Function. Its usage policy asks for one request per second
  and a real User-Agent, so it suits an overnight one-off rather than a button.
- **Photon**, **LocationIQ** (free tier, needs a key), or **Mapbox** (generous
  free tier, needs a key) if you want batch speed.

Be warned that OpenStreetMap's *street-address* coverage is much weaker than the
Census data in the US — worth testing on twenty real addresses before trusting
it. City-level pins are honest and may be all you need; `geo_precision` already
records which kind each pin is.

---

## 4. Your name and look

| What | Where |
| --- | --- |
| Browser title | `app/layout.tsx` → `metadata.title` |
| Wordmark in the nav rail | `components/nav-rail.tsx` → `Wordmark()` |
| Accent colour | `app/globals.css` → `--accent` (light **and** `.dark`) |
| Page/card/rail colours | `app/globals.css` → the `:root` and `.dark` blocks |
| Typeface | `app/layout.tsx` → the `next/font/google` import |

**One trap before you touch colours.** This app redefines what `black` and
`white` *mean* — `tailwind.config.ts` maps them to CSS variables so the whole UI
inverts for dark mode without 190 `dark:` variants. The consequence:
`text-white` is **not** a literal white. Read the comment at the top of
`tailwind.config.ts` before changing anything colour-related, or dark mode will
come apart in confusing ways.

Accent contrast is worth checking rather than eyeballing: the current teal passes
WCAG AA on cards in both themes (5.47 light, 9.45 dark). If you pick something
lighter, check it.

---

## 5. Your words

These contain one club's specifics — including a real person's email address.
**Rewrite them before you deploy anywhere public.**

- **`app/privacy/page.tsx`** and **`app/terms/page.tsx`** — mention Kennesaw
  State University and carry a contact address. They are also written to be
  *true*: if you change what the app stores or who it shares with, change these
  to match. They are required if you set up Google sign-in.
- **`app/(app)/guide/page.tsx`** — the in-app manual. The explanation of what a
  CRM is travels fine; the parts about plant tours and sponsorship are yours to
  rewrite.
- **`lib/changelog.ts`** — this club's release history. **Empty the array and
  start your own.** Keeping it means your guide tells your members about changes
  that happened to somebody else.
- **`README.md`** — describes this club.

---

## 6. Your data

**Starting from a spreadsheet:** `scripts/convert_directory.py` converts one to
importable CSVs, but it is written against *this* club's sheet — specific column
names, a specific "All Companies" tab. Read it as a worked example rather than a
tool, and expect to rewrite the column mapping.

**Starting from a CSV:** easier, and the importer is more forgiving than it
looks — several columns accept alternative names, so you often don't need to
rename anything. Extra columns are ignored and order doesn't matter.

**Companies** — only `name` is required:

| Column | Also accepted as |
| --- | --- |
| `name` | `company`, `company_name` |
| `website` | `url` |
| `industry` | `specialty` |
| `tier` | `confidence` |
| `type`, `status`, `interest`, `notes`, `city`, `region`, `address`, `phone`, `employees` | — |

**Contacts** — only `first_name` is required:

| Column | Also accepted as |
| --- | --- |
| `first_name` | `first`, `name` |
| `last_name` | `last`, `surname` |
| `phone` | `telephone`, `mobile` |
| `title` | `role`, `job_title` |
| `company` | `company_name`, `organisation` — matched to an existing company **by name** |
| `email`, `notes` | — |

`interest` is comma-separated and its values must match your `INTERESTS`.
`status` is lowercased with spaces turned into underscores, so "In Conversation"
becomes `in_conversation` — anything unrecognised falls back to `prospect`
rather than failing.

Re-importing is safe: companies whose name already exists are skipped, so you
can top up later with the full file. Note that the check is an **exact**
case-insensitive name match — "Acme Inc" and "Acme Inc." import as two
companies. Worth de-duplicating in the spreadsheet before you import, because
it is much more annoying afterwards.

**A warning about the addresses**, learned here the hard way: about 45% of this
club's imported rows had a placeholder like `"Atlanta, GA (verify address)"`
rather than a street address. No geocoder can fix that — it is a source-data gap,
and it caps how good your map can ever be. If you are assembling the list
yourself, getting real street addresses in from the start is worth more than any
tooling you can add later.

---

## 7. Sign-in, and the one limit that will annoy you

Magic links use Supabase's built-in email sender, which is capped at **a handful
of emails per hour for the entire project** — shared by everyone, not per person.
With more than two or three members you will hit it. The app now shows what's
left and refuses politely rather than failing with a raw error, but the ceiling
is real.

Two ways out, both free:

- **Google sign-in** ([SETUP.md Part F](SETUP.md)) — sends no email at all, so
  the limit stops existing. Best if your members have Google accounts. Also
  removes the "link opened in the wrong browser" failure, which is the most
  common reason a sign-in fails here.
- **Custom SMTP** — [Resend](https://resend.com)'s free tier is 3,000/month
  (100/day). Keeps magic links, raises the ceiling to ~30/hour.

**Access is always allowlist-first.** Both methods only get someone to the door:
`handle_new_user` creates a profile only for an address already in
`allowed_emails`. Anyone else lands on a dead end. Keep that property — it is the
entire security model.

---

## 8. What to delete

- **`design/`** — this club's UI exploration files. No runtime dependency.
- **`ROADMAP.md`** — one club's plans. Keep it as a menu of ideas if useful, but
  it is not a spec.
- **`data/`** — gitignored already, but check nothing of yours is committed.

Keep `HANDOFF.md`. It is the record of what already went wrong, and every entry
in it cost somebody real time.

---

## 9. What not to change

Four things are load-bearing. Each is explained in [HANDOFF.md](HANDOFF.md), and
each was learned by breaking it:

1. **Never merge `lib/supabase.ts` and `lib/supabase-browser.ts`.** The server one
   imports `next/headers` and is `server-only`; merging them pulls that into the
   browser bundle and every route 500s.
2. **Never revoke `EXECUTE` on `is_member()` / `is_admin()`.** Supabase's linter
   flags them and it looks like a bug worth fixing. RLS runs as the querying
   role, so revoking breaks every member query.
3. **`app/actions.ts` is `'use server'` — every export must be an async action.**
   A plain helper exported from it is a build error. Shared helpers go in `lib/`.
4. **`profiles` has column-level privileges.** Members may update `full_name`
   only; roles change through `set_member_role()`. Re-granting blanket `UPDATE`
   reopens a privilege escalation that was verified exploitable.

---

## 10. Adding a table later

The pattern this repo uses, in order:

1. Write `supabase/migrations/NNN_name.sql`, safe to re-run (`if not exists`, and
   the `pg_policies` guard pattern used throughout).
2. **Mirror it into `supabase/schema.sql`** so a fresh install gets it too. This
   is the step people forget.
3. `alter table … enable row level security` **in the same migration.** Policies
   for select/insert/update, and make delete narrower —
   `is_admin() or created_by = auth.uid()`.
4. If the table holds email addresses or anything personal, `revoke all … from
   anon` explicitly. Supabase grants `select` to `anon` on new public tables by
   default; RLS blocks the rows, but defence in depth is cheap.
5. Apply it by hand in the Supabase SQL editor.
6. Add a `lib/changelog.ts` entry in the same commit if it is user-visible.
7. `npm run typecheck && npm run build` before committing.

One practical note: **don't run `npm run build` while the dev server is running.**
It overwrites `.next` underneath it and the running server starts serving 404s
for its own JavaScript, which looks like a baffling app-wide failure.

---

## Getting help from the code itself

The comments in this repo explain *why*, not *what* — they are the most reliable
documentation here, because they were written next to the decision. When
something looks arbitrary, it usually is not; check the comment above it before
changing it.
