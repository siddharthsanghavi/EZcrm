'use client';

import { useActionState } from 'react';
import { saveClubDetails } from '@/app/actions';
import type { ClubDetails } from '@/lib/cold-email';

type State = { error?: string; ok?: boolean } | null;

/**
 * Client form so "only admins can change club settings" arrives as a sentence
 * rather than as a save that silently does nothing. RLS refuses a member's
 * write by matching no rows, which looks exactly like success.
 */
export function ClubDetailsForm({ club, isAdmin }: { club: ClubDetails; isAdmin: boolean }) {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await saveClubDetails(formData)) ?? null,
    null,
  );

  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
      <Field name="clubName" label="Club name" value={club.clubName} placeholder="Engineering Society" disabled={!isAdmin} />
      <Field name="school" label="School or university" value={club.school} placeholder="Riverbend University" disabled={!isAdmin} />
      <Field name="groupSize" label="Group size" value={club.groupSize} placeholder="20" disabled={!isAdmin} />
      <Field name="visitLength" label="Visit length" value={club.visitLength} placeholder="two hours" disabled={!isAdmin} />

      <div className="sm:col-span-2">
        {isAdmin ? (
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </button>
            {state?.ok && <span className="text-sm text-success">Saved.</span>}
            {state?.error && <span className="text-sm text-danger">{state.error}</span>}
          </div>
        ) : (
          <p className="text-xs text-black/45">
            Only admins can change these — they appear in mail the whole club sends.
          </p>
        )}
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  value,
  placeholder,
  disabled,
}: {
  name: string;
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
}) {
  // A placeholder value shows as an empty field with the example in grey:
  // typing over "[YOUR CLUB]" is worse than typing into a blank.
  const placeholderish = value.startsWith('[');

  return (
    <label className="block text-xs text-black/45">
      {label}
      <input
        name={name}
        defaultValue={placeholderish ? '' : value}
        placeholder={placeholderish ? placeholder : ''}
        disabled={disabled}
        className="field mt-1 disabled:opacity-60"
      />
    </label>
  );
}
