'use client';

import { useActionState, useState } from 'react';
import { saveContact } from '@/app/actions';
import type { Contact } from '@/lib/types';

type State = { error?: string; ok?: boolean } | null;

export type EditableContact = Pick<
  Contact,
  'id' | 'first_name' | 'last_name' | 'title' | 'email' | 'phone'
>;

/**
 * Edit one contact's own details from the contacts list.
 *
 * The company page edits contacts in the org tree, where the reporting line is
 * visible and a promotion usually means moving somebody up it. This is the
 * other case: a contact who belongs to no company yet appears in no tree at
 * all, so without this there is nowhere to fix a typo in their name.
 *
 * Company and division are deliberately absent. `saveContact` patches only the
 * fields it is sent, so leaving them out preserves them — a contact's company
 * is changed by attaching them from that company's page, not by a dropdown
 * buried in a list row.
 */
export function EditContact({ contact }: { contact: EditableContact }) {
  const [open, setOpen] = useState(false);

  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const result = (await saveContact(formData)) ?? null;
    if (result?.ok) setOpen(false);
    return result;
  }, null);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-black/30 hover:text-ink">
        Edit
      </button>
    );
  }

  return (
    <form action={action} className="w-full space-y-2 rounded-md bg-black/[0.02] p-3">
      <input type="hidden" name="id" value={contact.id} />

      <div className="flex gap-2">
        <input
          name="first_name"
          required
          defaultValue={contact.first_name}
          placeholder="First name *"
          className="field py-1.5"
        />
        <input
          name="last_name"
          defaultValue={contact.last_name ?? ''}
          placeholder="Last name"
          className="field py-1.5"
        />
      </div>

      <input
        name="title"
        defaultValue={contact.title ?? ''}
        placeholder="Title / role"
        className="field py-1.5"
      />
      <input
        name="email"
        type="email"
        defaultValue={contact.email ?? ''}
        placeholder="Email"
        className="field py-1.5"
      />
      <input
        name="phone"
        defaultValue={contact.phone ?? ''}
        placeholder="Phone"
        className="field py-1.5"
      />

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <button className="btn-ghost py-1.5 text-xs" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-black/40 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
