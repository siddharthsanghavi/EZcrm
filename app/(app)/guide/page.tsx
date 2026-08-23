import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import { CHANGELOG, LAST_UPDATED } from '@/lib/changelog';
import { STATUS_DOTS, STATUS_LABELS, STATUSES } from '@/lib/types';
import { FigureClaim, FigureDashboard, FigureLog } from '@/components/guide-figures';

export const dynamic = 'force-dynamic';

export default async function GuidePage() {
  const supabase = await serverClient();

  // Live numbers, so the guide describes real data rather than an idealised
  // example.
  const [{ count: companies }, { count: tier1 }, { count: mine }] = await Promise.all([
    supabase.from('companies').select('id', { count: 'exact', head: true }),
    supabase.from('companies').select('id', { count: 'exact', head: true }).eq('tier', 'Tier 1'),
    supabase.from('companies').select('id', { count: 'exact', head: true }).not('owner_id', 'is', null),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How to use EZcrm</h1>
        <p className="mt-1 text-sm text-black/55">
          Read it through, or jump to the part you need. Last updated{' '}
          {new Date(LAST_UPDATED + 'T00:00:00').toLocaleDateString()}.
        </p>
      </div>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">First — what is a CRM?</h2>
        <p className="mt-2 text-sm leading-relaxed text-black/70">
          CRM stands for <strong>customer relationship management</strong>, which is a corporate way
          of saying: <em>a shared memory of every conversation your group is having with people
          outside it.</em> That is genuinely all it is. A spreadsheet is a list of companies; a CRM
          also remembers who spoke to them, when, what was said, and what happens next.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-black/70">
          The problem it solves is specific. Outreach fails in two boring ways: two people email the
          same company and the club looks disorganised, or someone gets a &ldquo;maybe, ask me in
          September&rdquo; and nobody ever follows up. Both are memory failures, and both are
          invisible until the opportunity is already gone. Group chats and spreadsheets don&apos;t
          fix them, because neither one remembers <em>what happens next</em>.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-black/70">
          The trade is real, so it is worth saying plainly: this only works if people log things. It
          costs about fifteen seconds after a call. In exchange the club stops losing companies to
          silence, and whoever runs outreach next year inherits the history instead of starting from
          nothing.
        </p>
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">The four things it stores</h2>
        <p className="mt-2 text-sm leading-relaxed text-black/70">
          Everything here is one of four kinds of record, and they nest inside each other. Once this
          clicks, the rest of the app is obvious.
        </p>

        <dl className="mt-4 space-y-3">
          {MODEL.map((m) => (
            <div key={m.term} className="flex gap-3.5">
              <dt className="w-20 shrink-0 pt-0.5 text-sm font-semibold">{m.term}</dt>
              <dd className="text-sm leading-relaxed text-black/65">
                {m.body}
                <div className="mt-0.5 text-xs text-black/40">{m.example}</div>
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 border-t border-black/[0.07] pt-3 text-sm leading-relaxed text-black/65">
          So: a <strong>company</strong> has <strong>people</strong> at it, you keep a record of{' '}
          <strong>what has happened</strong> with them, and there is{' '}
          <strong>one thing you owe them next</strong>. If you only ever do one thing in this app,
          make it that last one.
        </p>
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">What a week actually looks like</h2>
        <ol className="mt-3 space-y-3 text-sm leading-relaxed text-black/70">
          <li>
            <strong>Monday, two minutes.</strong> Open the{' '}
            <GuideLink href="/">Dashboard</GuideLink>. Anything under{' '}
            <strong>Going cold</strong> is a company you started talking to and then went quiet on.
            Those are the cheapest wins available to you, because they already replied once.
          </li>
          <li>
            <strong>Clear anything overdue.</strong> It is at the top of{' '}
            <GuideLink href="/tasks">Tasks</GuideLink>. Each one is a promise you made to yourself.
          </li>
          <li>
            <strong>Pick up something new.</strong> Filter Companies to Tier 1 and Unassigned, take
            three, and contact them. Three a week is over a hundred a year.
          </li>
          <li>
            <strong>Log as you go, not later.</strong> After a call or an email, log it on the
            company page and set the next step before you close the tab. Later does not come.
          </li>
        </ol>

        <FigureDashboard />
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">What this is for</h2>
        <p className="mt-2 text-sm leading-relaxed text-black/70">
          We contact companies to ask for two things:{' '}
          <strong>plant tours</strong> and <strong>sponsorship</strong>. This app keeps track of who
          we&apos;ve approached, what was said, and what happens next — so two people don&apos;t
          email the same company, and nothing gets quietly forgotten.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-black/70">
          There are <strong>{(companies ?? 0).toLocaleString()}</strong> companies loaded, of which{' '}
          <strong>{tier1 ?? 0}</strong> are Tier 1 — the ones most worth calling first.
        </p>
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">Start here: pick your companies</h2>
        <p className="mt-2 text-sm leading-relaxed text-black/70">
          Go to <GuideLink href="/companies?tier=Tier+1">Companies</GuideLink>, filter to{' '}
          <strong>Tier 1</strong> and <strong>Unassigned</strong>, and take a few:
        </p>

        <FigureClaim />
        <p className="mt-3 text-xs text-black/45">
          {mine ?? 0} of {(companies ?? 0).toLocaleString()} companies are assigned so far.
          Assignment isn&apos;t a lock — it just means everyone knows who&apos;s handling it.
        </p>
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">Working a company</h2>
        <p className="mt-2 text-sm leading-relaxed text-black/70">
          Open a company and you can do everything from that one page:
        </p>
        <FigureLog />

        <ul className="mt-5 space-y-2 text-sm leading-relaxed text-black/70">
          <li>
            <strong>Log activity</strong> every time you email, call, or meet them. This is the
            important habit — the timeline is how anyone else knows what&apos;s happened. Your name
            is recorded automatically.
          </li>
          <li>
            <strong>Add contacts</strong> — the actual people, with their email and phone.
          </li>
          <li>
            <strong>Add a task</strong> with a due date so the follow-up doesn&apos;t depend on you
            remembering.
          </li>
          <li>
            <strong>Move the status</strong> as things progress. Every change is recorded with who
            made it.
          </li>
        </ul>
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">What the statuses mean</h2>
        <dl className="mt-3 space-y-2 text-sm text-black/70">
          {STATUSES.map((s) => (
            <div key={s} className="flex gap-3">
              <dt className="flex w-36 shrink-0 items-center gap-2 font-medium">
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATUS_DOTS[s]}`} />
                {STATUS_LABELS[s]}
              </dt>
              <dd className="text-black/60">{STATUS_HELP[s]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">The other tabs</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-black/70">
          <li>
            <GuideLink href="/">Dashboard</GuideLink> — counts by status, open tasks, and a{' '}
            <strong>going cold</strong> list: companies you started talking to but haven&apos;t
            touched in three weeks. Check this weekly.
          </li>
          <li>
            <GuideLink href="/pipeline">Pipeline</GuideLink> — a flowchart of where everything
            stands, plus who owns what. Numbers on the arrows are companies that actually moved that
            way.
          </li>
          <li>
            <GuideLink href="/map">Map</GuideLink> — zoomed out you see one bubble per region; zoom
            in and companies separate into individual pins. Useful for planning a trip: find several
            worth visiting in one area.
          </li>
          <li>
            <GuideLink href="/tasks">Tasks</GuideLink> — everything outstanding, overdue first.
          </li>
          <li>
            <GuideLink href="/members">Members</GuideLink> — set your display name, and (if
            you&apos;re an admin) add teammates.
          </li>
        </ul>
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">Tiers — what they mean</h2>
        <p className="mt-2 text-sm leading-relaxed text-black/70">
          Tiers come from the source list and rank how promising a company is.{' '}
          <strong>Tier 1</strong> is the shortlist — the best fits, worth calling first.{' '}
          <strong>Tier 2</strong> is strong, and{' '}
          <strong>Tier 3</strong> is worth a try. <strong>Reference</strong> is the long tail: real
          companies, but nobody has vetted them as good targets.
        </p>
        <p className="mt-3 text-sm text-black/70">
          If you only have an hour, spend it on{' '}
          <GuideLink href="/companies?tier=Tier+1&amp;status=prospect">
            Tier 1 companies nobody has contacted
          </GuideLink>
          .
        </p>
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">Things worth knowing</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-black/70">
          <li>
            <strong>Sign-in links only work in the browser that asked for one.</strong> If you
            request a link on your laptop, open it on your laptop.
          </li>
          <li>
            <strong>Everyone sees everything.</strong> There are no private records — assignment is
            about coordination, not permissions.
          </li>
          <li>
            <strong>Nothing is really deleted by accident.</strong> Only the person who created a
            record, or an admin, can delete it.
          </li>
          <li>
            <strong>Your data is yours.</strong> Import / Export gives you a CSV of everything at
            any time.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold">What&apos;s changed</h2>
        <p className="mt-1 text-xs text-black/45">
          Newest first. This list is updated whenever the app is.
        </p>
        <ol className="mt-4 space-y-5">
          {CHANGELOG.map((c, i) => (
            <li key={i} className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{c.title}</h3>
                <span className="text-xs text-black/40">
                  {new Date(c.date + 'T00:00:00').toLocaleDateString()}
                </span>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-black/65">
                {c.notes.map((n, j) => (
                  <li key={j}>{n}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** The data model in plain English. Teaching this is most of teaching the app. */
const MODEL = [
  {
    term: 'Company',
    body: 'The organisation you want something from. Everything else hangs off one of these.',
    example: 'Piedmont Tool & Die — a machine shop in Marietta',
  },
  {
    term: 'Contact',
    body: 'An actual person at that company, with their email and phone. Companies never reply to emails; people do.',
    example: 'Dana Alvarez, Plant Manager',
  },
  {
    term: 'Activity',
    body: 'Something that already happened — a call, an email, a visit. This is the memory. Your name and the date are recorded for you.',
    example: 'Called, left a voicemail with the front desk',
  },
  {
    term: 'Task',
    body: 'Something that has not happened yet, with a due date. This is the part that actually keeps outreach alive.',
    example: 'Call Dana back — due Friday',
  },
];

const STATUS_HELP: Record<string, string> = {
  prospect: 'On the list, nobody has reached out yet.',
  contacted: "You've emailed or called, but haven't heard back.",
  in_conversation: 'They replied and something is actually being discussed.',
  committed: "They've agreed — a tour is booked, or sponsorship confirmed.",
  declined: 'They said no. Worth recording so nobody asks again this year.',
  dormant: 'Went quiet, or the timing was wrong. Revisit later.',
};

function GuideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium underline underline-offset-2 hover:text-ink">
      {children}
    </Link>
  );
}
