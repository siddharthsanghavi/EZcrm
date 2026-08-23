import { STATUS_DOTS } from '@/lib/types';

/**
 * Figures for the guide.
 *
 * These are built from the app's own classes — `.card`, `.chip`, `.field`,
 * `STATUS_DOTS`, the accent token — rather than drawn as SVG with baked-in
 * hex values. That means a figure inherits dark mode, the type ramp, and any
 * future palette change for free, and cannot quietly disagree with the screen
 * it is teaching. The cost is that they are recreations, not captures: if you
 * restructure a screen, come and look at these.
 *
 * No JavaScript. The motion is CSS, and its resting state is the finished
 * state, so reduced-motion users see the outcome rather than an empty form.
 */

function Frame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="mt-4">
      <div className="overflow-hidden rounded-lg border border-black/10 bg-paper">
        {/* A plain title strip, not fake browser chrome — a painted address bar
            would be decoration pretending to be information. */}
        <div className="border-b border-black/[0.08] bg-rail px-3 py-1.5 text-[11px] font-medium text-black/40">
          {label}
        </div>
        <div className="p-3">{children}</div>
      </div>
    </figure>
  );
}

function Callout({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-[13px] leading-relaxed text-black/65">
      <span
        aria-hidden
        className="mt-[3px] inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center
                   rounded-full bg-ink text-[10px] font-bold text-white"
      >
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Marker({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full
                  bg-ink text-[10px] font-bold text-white ${className}`}
    >
      {n}
    </span>
  );
}

/** Claiming companies: tick a few, assign them to yourself. */
export function FigureClaim() {
  const rows = [
    { name: 'Piedmont Tool & Die', meta: 'Machine Shop · Marietta', tier: 'Tier 1', tick: true, delay: '' },
    { name: 'Northside Fabrication', meta: 'Integrator · Kennesaw', tier: 'Tier 1', tick: true, delay: 'fig-d2' },
    { name: 'Etowah Machine', meta: 'Machine Shop · Cartersville', tier: 'Tier 2', tick: false, delay: '' },
  ];

  return (
    <>
      <Frame label="Companies — filtered to Tier 1, Unassigned">
        <div className="card divide-y divide-black/[0.06] overflow-hidden">
          {rows.map((r, i) => (
            <div key={r.name} className="flex items-center gap-2.5 px-3 py-2">
              <span
                aria-hidden
                className={`h-[13px] w-[13px] shrink-0 rounded-[3px] border ${
                  r.tick ? `fig-tick ${r.delay} border-ink bg-ink` : 'border-black/25'
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{r.name}</span>
                <span className="block truncate text-[11px] text-black/45">{r.meta}</span>
              </span>
              <span className="chip shrink-0 bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-300">
                {r.tier}
              </span>
              <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATUS_DOTS.prospect}`} />
                <span className="text-[11px] text-black/50">Prospect</span>
              </span>
              {i === 0 && <Marker n={1} />}
            </div>
          ))}
        </div>

        <div className="fig-bar mt-2.5">
          <div className="card flex flex-wrap items-center gap-2 border-black/15 p-2">
            <span className="text-[12px] font-medium">2 selected</span>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-black/10" />
            <span className="field w-24 px-2 py-1 text-[11.5px] text-black/60">Alex</span>
            <span className="btn-ghost px-2.5 py-1 text-[11.5px]">Assign</span>
            <Marker n={2} />
          </div>
        </div>
      </Frame>

      <ol className="mt-3 space-y-1.5">
        <Callout n={1}>
          Tick the box on any company you want to take. Nothing happens until you act on the
          selection, so tick freely.
        </Callout>
        <Callout n={2}>
          A bar appears once something is ticked. Choose your name and press{' '}
          <strong>Assign</strong> — that is the whole thing.
        </Callout>
      </ol>
    </>
  );
}

/** Logging an activity, and what it does to the timeline. */
export function FigureLog() {
  return (
    <>
      <Frame label="Piedmont Tool & Die — Log activity">
        <div className="card p-3">
          <div className="flex flex-wrap gap-1.5">
            <span className="field w-20 px-2 py-1 text-[11.5px] text-black/70">call</span>
            <span className="field w-28 px-2 py-1 text-[11.5px] text-black/50">Dana Alvarez</span>
            <span className="field w-24 px-2 py-1 text-[11.5px] text-black/50">Today</span>
            <Marker n={1} className="mt-1" />
          </div>
          <div className="field mt-1.5 px-2 py-1 text-[11.5px] text-black/70">
            Spoke with the plant manager
          </div>
          <div className="field mt-1.5 px-2 py-1 text-[11.5px] leading-relaxed text-black/55">
            Open to a tour in October. Wants numbers first.
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Marker n={2} />
            <span className="btn-primary fig-press px-2.5 py-1 text-[11.5px]">Log it</span>
          </div>
        </div>

        <div className="mt-2.5 text-[11px] font-medium text-black/40">Timeline</div>
        <div className="card mt-1 overflow-hidden">
          <div className="fig-row overflow-hidden border-b border-black/[0.06] bg-accent/[0.06] px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-medium">
                <span className="chip mr-1.5 bg-black/[0.06] text-black/55">call</span>
                Spoke with the plant manager
              </span>
              <span className="shrink-0 text-[10.5px] text-black/40">just now</span>
            </div>
            <div className="mt-0.5 text-[10.5px] text-black/40">Logged by Alex</div>
          </div>
          <div className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px]">
                <span className="chip mr-1.5 bg-black/[0.06] text-black/55">email</span>
                Sent the sponsorship deck
              </span>
              <span className="shrink-0 text-[10.5px] text-black/40">6d ago</span>
            </div>
          </div>
        </div>
      </Frame>

      <ol className="mt-3 space-y-1.5">
        <Callout n={1}>
          Say what kind of contact it was and who with. The date defaults to today; change it if you
          are catching up on something older.
        </Callout>
        <Callout n={2}>
          Press <strong>Log it</strong> and it joins the timeline with your name on it. That entry
          is what stops this company appearing in <strong>Going cold</strong>.
        </Callout>
      </ol>
    </>
  );
}

/** Reading the dashboard. */
export function FigureDashboard() {
  const stages: { label: string; count: string; key: keyof typeof STATUS_DOTS; grow: number }[] = [
    { label: 'Prospect', count: '1,204', key: 'prospect', grow: 60 },
    { label: 'Contacted', count: '31', key: 'contacted', grow: 14 },
    { label: 'Talking', count: '12', key: 'in_conversation', grow: 10 },
    { label: 'Committed', count: '6', key: 'committed', grow: 8 },
  ];

  const cold = [
    { name: 'Piedmont Tool & Die', since: '34d', width: '100%' },
    { name: 'Northside Fabrication', since: '27d', width: '79%' },
  ];

  return (
    <>
      <Frame label="Dashboard">
        <div className="card px-3 py-2.5">
          <div className="grid grid-cols-4 gap-3">
            {stages.map((s) => (
              <div key={s.label}>
                <div className="flex items-center gap-1.5">
                  <span aria-hidden className={`h-[6px] w-[6px] rounded-full ${STATUS_DOTS[s.key]}`} />
                  <span className="truncate text-[10.5px] text-black/50">{s.label}</span>
                </div>
                <div className="mt-0.5 text-[17px] font-semibold leading-6 tabular-nums">
                  {s.count}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex h-1 gap-0.5 overflow-hidden rounded-full">
            {stages.map((s) => (
              <span key={s.label} className={STATUS_DOTS[s.key]} style={{ flexGrow: s.grow }} />
            ))}
          </div>
        </div>

        <div className="card mt-2.5 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/[0.08] px-3 py-2">
            <span className="text-[12px] font-semibold">Going cold</span>
            <span className="rounded-md bg-warn/[0.14] px-1.5 text-[10.5px] font-semibold text-warn">
              14
            </span>
            <Marker n={1} />
          </div>
          {cold.map((c) => (
            <div
              key={c.name}
              className="flex items-center gap-2.5 border-b border-black/[0.06] px-3 py-2 last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{c.name}</span>
              <span aria-hidden className="hidden h-1 w-14 overflow-hidden rounded-full bg-black/[0.07] sm:block">
                <span className="block h-1 rounded-full bg-warn" style={{ width: c.width }} />
              </span>
              <span className="w-12 text-right text-[11px] font-semibold tabular-nums text-warn">
                {c.since}
              </span>
            </div>
          ))}
        </div>
      </Frame>

      <ol className="mt-3 space-y-1.5">
        <Callout n={1}>
          The bar under the counts is the real proportion — most of the list will be Prospect for a
          long time, and that is fine. <strong>Going cold</strong> is the part to act on: the longer
          the amber bar, the longer that company has been waiting on you.
        </Callout>
      </ol>
    </>
  );
}
