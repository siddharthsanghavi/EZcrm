'use client';

import { useActionState } from 'react';
import { setCompanyStatus } from '@/app/actions';
import { STATUSES, STATUS_LABELS } from '@/lib/types';

type State = { error?: string; ok?: boolean } | null;

/**
 * Status, with room for the database to say no.
 *
 * "Committed" is gated: a company cannot reach it without a contact and a date.
 * That refusal arrives as a Postgres exception, and a plain `<form action>`
 * would swallow it — the dropdown would snap back and nobody would know why. So
 * this is a client form that can show the reason.
 */
export function StatusPicker({ companyId, status }: { companyId: string; status: string }) {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await setCompanyStatus(formData)) ?? null,
    null,
  );

  return (
    <div>
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="id" value={companyId} />
        <select name="status" defaultValue={status} className="field w-44 py-1.5" aria-label="Status">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button className="btn-ghost py-1.5" disabled={pending}>
          {pending ? 'Saving…' : 'Update'}
        </button>
      </form>

      {state?.error && (
        <p className="mt-1 max-w-xs text-right text-xs text-danger">
          {/* Postgres prefixes its own message; the useful half is the sentence. */}
          {state.error.replace(/^.*?:\s*/, '')}
        </p>
      )}
    </div>
  );
}
