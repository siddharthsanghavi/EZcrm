import Link from 'next/link';
import {
  GOAL_METRICS,
  GOAL_PERIOD_LABELS,
  type GoalMetric,
  type GoalProgress,
} from '@/lib/types';

/**
 * The club's goal, as three bars.
 *
 * Deliberately not a single headline number: "12 of 40 this month" and "0 of 3
 * today" say different things, and a club that is ahead for the month can still
 * have done nothing since Tuesday. Over-target bars stay full rather than
 * overflowing — passing a goal is worth seeing, not worth a broken layout.
 */
export function GoalProgressCard({
  progress,
  metric,
}: {
  progress: GoalProgress[];
  metric: GoalMetric;
}) {
  if (progress.length === 0) return null;

  const label = (GOAL_METRICS.find((m) => m.id === metric) ?? GOAL_METRICS[0]).label.toLowerCase();

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Goal</h2>
        <Link href="/settings" className="text-xs text-black/40 hover:text-ink">
          {label}
        </Link>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {progress.map(({ period, target, done }) => {
          const share = Math.min(1, target === 0 ? 0 : done / target);
          const met = done >= target;

          return (
            <div key={period}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-black/45">{GOAL_PERIOD_LABELS[period]}</span>
                <span
                  className={`text-xs tabular-nums ${met ? 'font-semibold text-accent' : 'text-black/55'}`}
                >
                  {done} / {target}
                </span>
              </div>
              <span
                aria-hidden
                className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-black/[0.07]"
              >
                <span
                  className={`block h-1.5 rounded-full ${met ? 'bg-accent' : 'bg-ink/50'}`}
                  style={{ width: `${Math.round(share * 100)}%` }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
