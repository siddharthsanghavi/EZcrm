'use client';

import { useActionState } from 'react';
import { reassignMember, saveRottingRules } from '@/app/actions';
import {
  ROTTING_DEFAULTS,
  STATUSES,
  STATUS_LABELS,
  type Profile,
  type RottingRules,
} from '@/lib/types';

type State = { error?: string; ok?: boolean; companies?: number; tasks?: number } | null;

/**
 * How long each stage may sit untouched before a company is flagged.
 *
 * One number for everything was too blunt: a week in "contacted" is fine, a
 * month in "in conversation" means the conversation stopped. Leaving a stage
 * blank means it never goes cold, which is right for Prospect — nobody has
 * promised a prospect anything.
 */
export function RottingRulesForm({ rules, isAdmin }: { rules: RottingRules; isAdmin: boolean }) {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await saveRottingRules(formData)) ?? null,
    null,
  );

  return (
    <form action={action} className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {STATUSES.map((status) => (
          <label key={status} className="block text-xs text-black/45">
            {STATUS_LABELS[status]}
            <input
              name={status}
              type="number"
              min={0}
              defaultValue={rules[status] ?? ''}
              placeholder={ROTTING_DEFAULTS[status] ? String(ROTTING_DEFAULTS[status]) : 'never'}
              disabled={!isAdmin}
              className="field mt-1 disabled:opacity-60"
            />
          </label>
        ))}
      </div>

      <p className="text-xs text-black/40">
        Days without a logged touch. Leave one blank and companies at that stage are never flagged.
      </p>

      {isAdmin ? (
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save rules'}
          </button>
          {state?.ok && <span className="text-sm text-success">Saved.</span>}
          {state?.error && <span className="text-sm text-danger">{state.error}</span>}
        </div>
      ) : (
        <p className="text-xs text-black/45">Only admins can change the going-cold rules.</p>
      )}
    </form>
  );
}

/**
 * Hand one member's work to another.
 *
 * Sits next to Remove on the members list, because removing somebody without
 * moving their work is the mistake it exists to prevent: their companies keep
 * an owner who no longer exists, and the going-cold list quietly stops making
 * sense. Moving to nobody is allowed — sometimes the work goes back in the pool.
 */
export function HandoffForm({
  member,
  members,
}: {
  member: Pick<Profile, 'id' | 'full_name' | 'email'>;
  members: Pick<Profile, 'id' | 'full_name' | 'email'>[];
}) {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await reassignMember(formData)) ?? null,
    null,
  );

  const others = members.filter((m) => m.id !== member.id);

  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="from_member" value={member.id} />
      <select
        name="to_member"
        defaultValue=""
        aria-label={`Move work from ${member.email} to`}
        className="field w-32 py-1 text-xs"
      >
        <option value="">Nobody</option>
        {others.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name?.trim() || m.email.split('@')[0]}
          </option>
        ))}
      </select>

      <button className="text-xs text-black/45 hover:text-ink" disabled={pending}>
        {pending ? 'Moving…' : 'Hand off'}
      </button>

      {state?.ok && (
        <span className="text-xs text-success">
          Moved {state.companies} compan{state.companies === 1 ? 'y' : 'ies'} and {state.tasks} task
          {state.tasks === 1 ? '' : 's'}.
        </span>
      )}
      {state?.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
