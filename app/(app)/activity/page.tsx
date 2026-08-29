import Link from 'next/link';
import { ActivityFeed } from '@/components/activity-feed';
import { loadFeed } from '@/lib/audit';
import { AUDIT_ENTITIES, AUDIT_ENTITY_LABELS, type AuditEntity } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Search = { entity?: string };

/**
 * Everything that has happened, newest first.
 *
 * Grouped by day rather than shown as one long list: "what happened yesterday"
 * is the question people actually arrive with, and a date heading answers it
 * without anyone having to read timestamps.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { entity } = await searchParams;
  const filter = AUDIT_ENTITIES.includes(entity as AuditEntity) ? entity : undefined;

  // Collapsing runs happens below, after the query, so a big CSV import can
  // still consume the whole window even though it renders as one line. 500 is
  // enough that a 400-row import does not push the rest of the week off the
  // page, and small enough to stay one cheap indexed read.
  const events = await loadFeed({ entity: filter, limit: 500 });

  // Group into days, keeping the newest-first order the query already gives.
  const days: { label: string; rows: typeof events }[] = [];
  for (const e of events) {
    const label = dayLabel(e.at);
    const last = days[days.length - 1];
    if (last?.label === label) last.rows.push(e);
    else days.push({ label, rows: [e] });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-black/55">
          Every change anyone has made — companies, contacts, tasks, outreach, deletions,
          membership, and imports and exports. Sign-ins are not here; they live under{' '}
          <Link href="/members" className="underline">
            Members
          </Link>
          .
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Pill href="/activity" active={!filter}>
          Everything
        </Pill>
        {AUDIT_ENTITIES.map((e) => (
          <Pill key={e} href={`/activity?entity=${e}`} active={filter === e}>
            {AUDIT_ENTITY_LABELS[e]}
          </Pill>
        ))}
      </div>

      {days.length > 0 ? (
        days.map((d) => (
          <section key={d.label} className="card overflow-hidden">
            <h2 className="border-b border-black/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-black/45">
              {d.label}
            </h2>
            <ActivityFeed events={d.rows} timeOnly />
          </section>
        ))
      ) : (
        <div className="card">
          <p className="px-5 py-6 text-sm text-black/45">
            Nothing recorded yet. The feed starts from the day this went in — anything done before
            that was not logged.
          </p>
        </div>
      )}
    </div>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function Pill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
        active ? 'bg-ink text-white' : 'bg-black/[0.05] text-black/60 hover:bg-black/10'
      }`}
    >
      {children}
    </Link>
  );
}
