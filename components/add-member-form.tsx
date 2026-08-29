'use client';

import { useActionState, useRef } from 'react';
import { addAllowedEmail } from '@/app/actions';

type State = { error?: string; ok?: boolean } | null;

/** Client form so "that address is already on the list" can actually be shown. */
export function AddMemberForm() {
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const result = (await addAllowedEmail(formData)) ?? null;
    if (result?.ok) formRef.current?.reset();
    return result;
  }, null);

  return (
    <form ref={formRef} action={action} className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="name@club.org"
          className="field max-w-xs"
        />
        <input name="note" placeholder="Note (optional)" className="field max-w-[10rem]" />
        {/* Chosen at invitation time rather than after: an invited viewer who
            arrives as a member has already had write access for a day. */}
        <select name="role" defaultValue="member" aria-label="Role" className="field w-28">
          <option value="viewer">viewer</option>
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button className="btn-primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {state?.ok && (
        <p className="text-sm text-success">
          Added. They can sign in now — send them the link to the app.
        </p>
      )}
    </form>
  );
}
