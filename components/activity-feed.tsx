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
      {events.map((e) => {
        const action = e.action as AuditAction;
        const company = e.companies;
        const summary =
          omitName && e.summary.startsWith(`${omitName}: `)
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
              {showCompany && company && e.company_id && (
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
