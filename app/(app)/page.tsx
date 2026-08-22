import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import {
  COLD_AFTER_DAYS,
  STATUS_LABELS,
  STATUS_STYLES,
  STATUSES,
  displayName,
  isCold,
  sinceLabel,
  type Status,
} from '@/lib/types';
import { TaskRow } from '@/components/task-row';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const supabase = await serverClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: companies }, { data: tasks }, { data: activities }] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, status, last_touch_at, profiles!companies_owner_id_fkey(full_name, email)')
      .order('last_touch_at', { ascending: true, nullsFirst: true }),
    supabase
      .from('tasks')
      .select('id, title, due_date, done, company_id, companies(name)')
      .eq('done', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(8),
    supabase
      .from('activities')
      .select('id, type, subject, occurred_at, company_id, companies(name)')
      .order('occurred_at', { ascending: false })
      .limit(8),
  ]);

  const all = companies ?? [];
  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, all.filter((c) => c.status === s).length]),
  ) as Record<Status, number>;

  const overdue = (tasks ?? []).filter((t) => t.due_date && t.due_date < today).length;

  // Anything sitting in an active stage without a logged touch in three weeks
  // is the thing most likely to quietly die, so surface it above everything
  // else. Already ordered oldest-touch-first by the query, so the top of this
  // list is the worst of it.
  const cold = all.filter((c) => isCold(c.status as Status, c.last_touch_at));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-black/55">
          {all.length} companies tracked
          {overdue > 0 && <> · {overdue} overdue task{overdue === 1 ? '' : 's'}</>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATUSES.map((status) => (
          <Link
            key={status}
            href={`/companies?status=${status}`}
            className="card p-4 transition hover:border-black/25"
          >
            <div className="text-2xl font-semibold tabular-nums">{counts[status]}</div>
            <div className="mt-1 text-xs text-black/55">{STATUS_LABELS[status]}</div>
          </Link>
        ))}
      </div>

      {cold.length > 0 && (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
            <h2 className="text-sm font-semibold">
              Going cold · {cold.length} untouched in {COLD_AFTER_DAYS}+ days
            </h2>
            {cold.length > 5 && (
              <Link href="/companies?cold=1" className="text-xs text-black/45 hover:text-ink">
                See all →
              </Link>
            )}
          </div>
          <ul className="divide-y divide-black/5">
            {cold.slice(0, 5).map((c) => {
              const owner = c.profiles as unknown as
                | { full_name: string | null; email: string }
                | null;
              return (
                <li key={c.id}>
                  <Link
                    href={`/companies/${c.id}`}
                    className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-black/[0.02]"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    {owner && (
                      <span className="hidden shrink-0 text-xs text-black/45 sm:block">
                        {displayName(owner)}
                      </span>
                    )}
                    <span className="shrink-0 text-xs font-medium text-warn">
                      {sinceLabel(c.last_touch_at)}
                    </span>
                    <span className={`chip shrink-0 ${STATUS_STYLES[c.status as Status]}`}>
                      {STATUS_LABELS[c.status as Status]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">Open tasks</h2>
          {tasks && tasks.length > 0 ? (
            <ul className="divide-y divide-black/5">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task as never} today={today} />
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-black/45">Nothing outstanding.</p>
          )}
        </section>

        <section className="card overflow-hidden">
          <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">
            Recent activity
          </h2>
          {activities && activities.length > 0 ? (
            <ul className="divide-y divide-black/5">
              {activities.map((a) => {
                const company = a.companies as unknown as { name: string } | null;
                return (
                  <li key={a.id} className="px-5 py-3 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate">
                        <span className="text-black/45">{a.type}</span>{' '}
                        {a.subject ?? 'Note'}
                      </span>
                      <span className="shrink-0 text-xs text-black/40">
                        {new Date(a.occurred_at).toLocaleDateString()}
                      </span>
                    </div>
                    {company && a.company_id && (
                      <Link
                        href={`/companies/${a.company_id}`}
                        className="text-xs text-black/50 hover:text-ink"
                      >
                        {company.name}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-black/45">No activity logged yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
