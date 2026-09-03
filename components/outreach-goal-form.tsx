'use client';

import { useActionState } from 'react';
import { saveOutreachGoal } from '@/app/actions';
import { GOAL_METRICS, type OutreachGoal } from '@/lib/types';

type State = { error?: string; ok?: boolean } | null;

export function OutreachGoalForm({ goal, isAdmin }: { goal: OutreachGoal; isAdmin: boolean }) {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await saveOutreachGoal(formData)) ?? null,
    null,
  );

  const metric = GOAL_METRICS.find((m) => m.id === goal.metric) ?? GOAL_METRICS[0];

  return (
    <form action={action} className="mt-4 space-y-3">
      <label className="block text-xs text-black/45">
        Count
        <select name="metric" defaultValue={goal.metric} disabled={!isAdmin} className="field mt-1 disabled:opacity-60">
          {GOAL_METRICS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-black/40">{metric.means}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Target name="daily" label="Per day" value={goal.daily} placeholder="3" disabled={!isAdmin} />
        <Target name="monthly" label="Per month" value={goal.monthly} placeholder="40" disabled={!isAdmin} />
        <Target name="yearly" label="Per year" value={goal.yearly} placeholder="300" disabled={!isAdmin} />
      </div>

      {/* Said plainly, because a club whose year starts in September will
          otherwise wonder why the yearly bar reset in January. */}
      <p className="text-xs text-black/40">
        Periods are calendar ones: the day ends at midnight, the year runs January to December.
      </p>

      {isAdmin ? (
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save goal'}
          </button>
          {state?.ok && <span className="text-sm text-success">Saved.</span>}
          {state?.error && <span className="text-sm text-danger">{state.error}</span>}
        </div>
      ) : (
        <p className="text-xs text-black/45">Only admins can set the club goal.</p>
      )}
    </form>
  );
}

function Target({
  name,
  label,
  value,
  placeholder,
  disabled,
}: {
  name: string;
  label: string;
  value: number | null;
  placeholder: string;
  disabled: boolean;
}) {
  return (
    <label className="block text-xs text-black/45">
      {label}
      <input
        name={name}
        type="number"
        min={0}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        className="field mt-1 disabled:opacity-60"
      />
    </label>
  );
}
