import 'server-only';

import { serverClient } from '@/lib/supabase';
import {
  type GoalPeriod,
  type GoalProgress,
  type OutreachGoal,
} from '@/lib/types';

const toNumber = (v: unknown) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The club's outreach goal.
 *
 * Three targets rather than one, because the two questions a committee asks are
 * different sizes: "did we do anything today?" and "are we on track for the
 * year?". Each is optional — a club that only cares about a monthly number
 * leaves the other two blank and sees only that.
 *
 * Stored as a `settings` row, so this needed no migration: the table is
 * key/value precisely so a new preference is a row rather than a schema change.
 */
export async function loadGoal(): Promise<OutreachGoal> {
  const supabase = await serverClient();
  const { data } = await supabase.from('settings').select('value').eq('key', 'goal').maybeSingle();

  const value = (data?.value ?? {}) as Record<string, unknown>;

  return {
    metric: value.metric === 'contacted' ? 'contacted' : 'outreach',
    daily: toNumber(value.daily),
    monthly: toNumber(value.monthly),
    yearly: toNumber(value.yearly),
  };
}

/**
 * Where each period starts, in the club's own reckoning.
 *
 * Calendar boundaries, computed from the server's clock: a "day" ends at
 * midnight, a "year" is January to December rather than the academic year. That
 * is a real limitation for a student club whose year starts in autumn — worth
 * changing the day somebody asks, and not worth a start-month setting nobody
 * has asked for yet.
 */
function startOf(period: GoalPeriod): Date {
  const now = new Date();
  if (period === 'daily') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'monthly') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), 0, 1);
}

/**
 * How far along each configured target is.
 *
 * One query per configured period rather than one query bucketed by date: at
 * three periods and a few thousand rows this is cheaper to read than it is to
 * optimise, and an unset target costs nothing because it is never queried.
 */
export async function loadGoalProgress(goal: OutreachGoal): Promise<GoalProgress[]> {
  const periods = (['daily', 'monthly', 'yearly'] as GoalPeriod[]).filter((p) => goal[p] !== null);
  if (periods.length === 0) return [];

  const supabase = await serverClient();

  const counts = await Promise.all(
    periods.map(async (period) => {
      const since = startOf(period).toISOString();

      if (goal.metric === 'contacted') {
        // Out of Prospect for the first time. `from_status` is null on the row
        // seeded at creation, so those never count as an act of outreach.
        const { count } = await supabase
          .from('status_events')
          .select('id', { count: 'exact', head: true })
          .eq('from_status', 'prospect')
          .gte('changed_at', since);
        return { period, target: goal[period]!, done: count ?? 0 };
      }

      const { count } = await supabase
        .from('activities')
        .select('id', { count: 'exact', head: true })
        .gte('occurred_at', since);
      return { period, target: goal[period]!, done: count ?? 0 };
    }),
  );

  return counts;
}
