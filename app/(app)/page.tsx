import Link from 'next/link';
import { currentProfile, serverClient } from '@/lib/supabase';
import {
  COLD_AFTER_DAYS,
  STATUS_DOTS,
  STATUS_LABELS,
  STATUSES,
  canWrite,
  coldFilter,
  daysSince,
  displayName,
  sinceLabel,
  todayIn,
  dayLabelIn,
  timeLabelIn,
  wallClockIn,
  EVENT_KIND_DOTS,
  type CalendarEvent,
  type Status,
} from '@/lib/types';
import { TaskRow } from '@/components/task-row';
import { ActivityFeed } from '@/components/activity-feed';
import { loadFeed } from '@/lib/audit';
import { GoalProgressCard } from '@/components/goal-progress';
import { loadGoal, loadGoalProgress } from '@/lib/goal';
import { loadRottingRules, loadTimeZone } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const supabase = await serverClient();

  // Two stages, not six. Stage one is everything the queries below depend on:
  // who is signed in (shared with the layout via cache()), the rotting rules
  // that decide which stages can go cold, the zone that decides what "today"
  // is, and the goal whose progress gets counted. Each of those used to be its
  // own await, and every await is a full round trip to Supabase.
  const [me, rotting, timeZone, goal] = await Promise.all([
    currentProfile(),
    loadRottingRules(),
    loadTimeZone(),
    loadGoal(),
  ]);
  const writable = canWrite(me);
  const today = todayIn(timeZone);

  // Every count here is a `head: true` count, never a length. Selecting the rows
  // and counting them in TypeScript caps silently at the API's default row limit
  // — at 1,267 companies the dashboard read "1,000 tracked, 0 contacted", because
  // the one contacted company sorted past the cap.
  const [total, statusCounts, { data: tasks }, { data: coldRows, count: coldCount }, feed, progress, { data: soon }] =
    await Promise.all([
      supabase.from('companies').select('id', { count: 'exact', head: true }),
      Promise.all(
        STATUSES.map((s) =>
          supabase.from('companies').select('id', { count: 'exact', head: true }).eq('status', s),
        ),
      ),
      supabase
        .from('tasks')
        .select('id, title, due_date, done, company_id, companies(name)')
        .eq('done', false)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(8),
      // Anything sitting in a stage without a logged touch for longer than that
      // stage tolerates is the thing most likely to quietly die, so surface it
      // above everything else. Filtered server-side by the same rule `isCold`
      // applies, ordered worst-first, and only the five rendered are fetched —
      // the badge uses the exact count rather than the page length.
      supabase
        .from('companies')
        .select(
          'id, name, status, last_touch_at, profiles!companies_owner_id_fkey(full_name, email)',
          { count: 'exact' },
        )
        .or(coldFilter(rotting))
        .order('last_touch_at', { ascending: true, nullsFirst: true })
        .range(0, 4),
      // Not just logged outreach any more: everything anyone did. See
      // supabase/migrations/013_deletions_audit_roles_and_org_chart.sql.
      loadFeed({ limit: 8 }),
      // Needs the goal and zone from stage one, nothing from this stage.
      loadGoalProgress(goal, timeZone),
      // The next two weeks of tours and events. Anything already under way
      // still shows, so a tour that started an hour ago is not hidden.
      supabase
        .from('events')
        .select('id, kind, title, starts_at, ends_at, company_id, companies(id, name)')
        .gte('starts_at', new Date(Date.now() - 6 * 3600e3).toISOString())
        .lt('starts_at', new Date(Date.now() + 14 * 864e5).toISOString())
        .order('starts_at')
        .limit(6),
    ]);

  const totalCompanies = total.count ?? 0;
  const counts = Object.fromEntries(
    STATUSES.map((s, i) => [s, statusCounts[i].count ?? 0]),
  ) as Record<Status, number>;

  const overdue = (tasks ?? []).filter((t) => t.due_date && t.due_date < today).length;

  const cold = coldRows ?? [];
  const coldTotal = coldCount ?? 0;
  // Never-touched has no day count, so it anchors the bar at full length. The
  // list is ordered worst-first, so the worst of the rendered rows is the right
  // thing to scale the bars against.
  const worstCold = Math.max(0, ...cold.map((c) => daysSince(c.last_touch_at) ?? Infinity).filter(Number.isFinite));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-black/55">
          {totalCompanies.toLocaleString()} companies tracked
          {overdue > 0 && <> · {overdue} overdue task{overdue === 1 ? '' : 's'}</>}
        </p>
      </div>

      {/* One card rather than six, with a proportional bar underneath: the
          split between stages is the thing worth seeing, and six equal boxes
          actively hide it — 1,204 prospects and 6 committed look the same. */}
      <section className="card px-5 py-4">
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          {STATUSES.map((status) => (
            <Link key={status} href={`/companies?status=${status}`} className="group">
              <div className="flex items-center gap-1.5">
                <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${STATUS_DOTS[status]}`} />
                <span className="truncate text-xs text-black/55">{STATUS_LABELS[status]}</span>
              </div>
              <div className="mt-1 text-[25px] font-semibold leading-8 tracking-tight tabular-nums
                              transition group-hover:text-accent">
                {counts[status].toLocaleString()}
              </div>
            </Link>
          ))}
        </div>

        {totalCompanies > 0 && (
          <div className="mt-4 flex h-[5px] gap-0.5 overflow-hidden rounded-full">
            {STATUSES.filter((s) => counts[s] > 0).map((status) => (
              <span
                key={status}
                title={`${STATUS_LABELS[status]} · ${counts[status]}`}
                className={STATUS_DOTS[status]}
                style={{ flexGrow: counts[status] }}
              />
            ))}
          </div>
        )}
      </section>

      {coldTotal > 0 && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.08] px-5 py-3">
            <div className="flex items-center gap-2.5">
              <svg
                width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="text-warn" aria-hidden
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              <h2 className="text-sm font-semibold">Going cold</h2>
              <span className="rounded-md bg-warn/[0.14] px-1.5 py-px text-[11.5px] font-semibold text-warn">
                {coldTotal}
              </span>
              <span className="hidden text-xs text-black/45 sm:inline">
                untouched {COLD_AFTER_DAYS}+ days
              </span>
            </div>
            {coldTotal > 5 && (
              <Link href="/companies?cold=1" className="text-xs text-black/45 hover:text-ink">
                See all →
              </Link>
            )}
          </div>

          <ul className="divide-y divide-black/[0.06]">
            {cold.map((c) => {
              const owner = c.profiles as unknown as
                | { full_name: string | null; email: string }
                | null;
              const days = daysSince(c.last_touch_at);
              // Bar length is how overdue it is, against the worst on the list.
              // The number alone reads flat; the bar makes the top of the list
              // look as urgent as it is.
              const share = days === null ? 1 : Math.min(1, days / Math.max(worstCold, 1));

              return (
                <li key={c.id}>
                  <Link
                    href={`/companies/${c.id}`}
                    className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-black/[0.02] sm:gap-4"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>

                    <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOTS[c.status as Status]}`}
                      />
                      <span className="text-xs text-black/55">
                        {STATUS_LABELS[c.status as Status]}
                      </span>
                    </span>

                    {owner && (
                      <span className="hidden w-20 shrink-0 truncate text-xs text-black/45 lg:block">
                        {displayName(owner)}
                      </span>
                    )}

                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="hidden h-1 w-16 overflow-hidden rounded-full bg-black/[0.07] sm:block"
                      >
                        <span
                          className="block h-1 rounded-full bg-warn"
                          style={{ width: `${Math.round(share * 100)}%` }}
                        />
                      </span>
                      <span className="w-14 text-right text-xs font-semibold tabular-nums text-warn">
                        {sinceLabel(c.last_touch_at)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(soon ?? []).length > 0 && (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
            <h2 className="text-sm font-semibold">Coming up</h2>
            <Link href="/calendar" className="text-xs text-black/45 hover:text-ink">
              Calendar →
            </Link>
          </div>
          <ul className="divide-y divide-black/5">
            {((soon ?? []) as unknown as (CalendarEvent & { companies: { id: string; name: string } | null })[]).map(
              (e) => (
                <li key={e.id} className="flex items-baseline gap-3 px-5 py-3 text-sm">
                  <span className="w-24 shrink-0 text-xs text-black/50">{dayLabelIn(timeZone, e.starts_at)}</span>
                  <span aria-hidden className={`h-2 w-2 shrink-0 self-center rounded-full ${EVENT_KIND_DOTS[e.kind]}`} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{e.title}</span>
                    {e.companies && (
                      <>
                        {' · '}
                        <Link href={`/companies/${e.companies.id}`} className="text-black/55 hover:underline">
                          {e.companies.name}
                        </Link>
                      </>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-black/45">
                    {wallClockIn(timeZone, e.starts_at).time === '00:00' ? 'All day' : timeLabelIn(timeZone, e.starts_at)}
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      <GoalProgressCard progress={progress} metric={goal.metric} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">Open tasks</h2>
          {tasks && tasks.length > 0 ? (
            <ul className="divide-y divide-black/5">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task as never} today={today} readOnly={!writable} />
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-black/45">Nothing outstanding.</p>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <Link href="/activity" className="text-xs text-black/45 hover:text-ink">
              See all
            </Link>
          </div>
          <ActivityFeed events={feed} empty="Nothing recorded yet." />
        </section>
      </div>
    </div>
  );
}
