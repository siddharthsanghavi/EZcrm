import Link from 'next/link';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_STYLES,
  actorName,
  type AuditAction,
  type AuditEvent,
} from '@/lib/types';

export type FeedRow = AuditEvent & {
  profiles: { full_name: string | null; email: string } | null;
  companies?: { id: string; name: string } | null;
};

/**
 * "2:14 pm" for today, "12 Aug" before that — the feed is scanned, not read.
 * Under a date heading the date is already known, so `timeOnly` drops it rather
 * than printing "Aug 25" on every row of a section titled Yesterday.
 */
function when(iso: string, timeOnly: boolean) {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return timeOnly || sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Collapse a run of identical actions by one person into a single line.
 *
 * A 1,200-row CSV import produces 1,200 "Added X" events, which is correct in
 * the table and useless in a feed — it buries everything else for days. Runs of
 * the same actor doing the same thing to the same kind of record, within an
 * hour, become "Added 1,200 companies", and the individual rows stay in the
 * database for anyone who needs them.
 */
function collapse(events: FeedRow[]): (FeedRow & { runLength: number })[] {
  const out: (FeedRow & { runLength: number })[] = [];

  for (const e of events) {
    const last = out[out.length - 1];
    const sameKind =
      last &&
      last.actor === e.actor &&
      last.action === e.action &&
      last.entity === e.entity &&
      Math.abs(new Date(last.at).getTime() - new Date(e.at).getTime()) < 3600_000;

    // Two is not a run worth hiding, and collapsing it would cost the reader
    // the detail for no gain in density.
    if (sameKind && (last.runLength > 1 || summaryVerb(last) === summaryVerb(e))) {
      last.runLength += 1;
    } else {
      out.push({ ...e, runLength: 1 });
    }
  }

  return out;
}

/** The leading word of a summary — "Added", "Edited" — used to spot a run. */
function summaryVerb(e: FeedRow) {
  return e.summary.split(' ')[0];
}

const PLURAL: Record<string, string> = {
  company: 'companies',
  contact: 'contacts',
  task: 'tasks',
  activity: 'log entries',
  deletion_request: 'deletion requests',
  member: 'members',
  data: 'transfers',
};

/**
 * One line per thing that happened.
 *
 * The summary sentence is written by the database trigger rather than composed
 * here, so an event logged by a bulk update or a hand-run query reads the same
 * as one from the UI — there is no second, prettier version of the truth that
 * only the app knows how to produce.
 */
export function ActivityFeed({
  events,
  showCompany = true,
  timeOnly = false,
  omitName,
  empty = 'Nothing yet.',
}: {
  events: FeedRow[];
  /** Off on a company's own page, where every line is about this company. */
  showCompany?: boolean;
  /** On when the caller already groups rows under a date heading. */
  timeOnly?: boolean;
  /**
   * On a company's own page every line starts with that company's name, which
   * is both redundant and expensive in a narrow column. Strip it where the
   * trigger used the "Name: detail" shape — the verb forms ("Added contact X")
   * read fine as they are.
   */
  omitName?: string;
  empty?: string;
}) {
  if (events.length === 0) {
    return <p className="px-5 py-6 text-sm text-black/45">{empty}</p>;
  }

  return (
    <ul className="divide-y divide-black/5">
      {collapse(events).map((e) => {
        const action = e.action as AuditAction;
        const company = e.companies;
        const collapsed = e.runLength > 1;
        const summary = collapsed
          ? `${summaryVerb(e)} ${e.runLength} ${PLURAL[e.entity] ?? e.entity}`
          : omitName && e.summary.startsWith(`${omitName}: `)
            ? e.summary.slice(omitName.length + 2)
            : e.summary;

        return (
          <li key={e.id} className="px-5 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className={`chip mr-2 ${AUDIT_ACTION_STYLES[action]}`}>
                  {AUDIT_ACTION_LABELS[action]}
                </span>
                {summary}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-black/40">{when(e.at, timeOnly)}</span>
            </div>

            <div className="mt-0.5 text-xs text-black/40">
              {actorName(e.profiles)}
              {/* A collapsed run spans several companies, so naming one of them
                  would be actively misleading. */}
              {!collapsed && showCompany && company && e.company_id && (
                <>
                  {' · '}
                  <Link href={`/companies/${e.company_id}`} className="hover:text-ink">
                    {company.name}
                  </Link>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
