'use client';

import { useActionState, useState } from 'react';
import { attachContact } from '@/app/actions';
import { contactName, type Contact } from '@/lib/types';

type State = { error?: string; ok?: boolean } | null;

export type UnlinkedContact = Pick<Contact, 'id' | 'first_name' | 'last_name' | 'title' | 'email'>;

/**
 * Add somebody who is already in the CRM but belongs to no company yet.
 *
 * Importing a contacts CSV whose `company` column matches nothing leaves the
 * person unlinked — the importer reports it and carries on rather than dropping
 * the row. This is where those people get filed, without retyping them and
 * without creating a second copy.
 *
 * Collapsed to a link until asked for: on most companies there is nothing to
 * attach, and an empty dropdown sitting under the new-contact form is a control
 * that looks broken.
 */
export function AttachContact({
  companyId,
  contacts,
}: {
  companyId: string;
  contacts: UnlinkedContact[];
}) {
  const [open, setOpen] = useState(false);

  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const result = (await attachContact(formData)) ?? null;
    if (result?.ok) setOpen(false);
    return result;
  }, null);

  if (contacts.length === 0) return null;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs text-black/45 hover:text-ink">
        Or add an existing contact ({contacts.length} without a company)
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 space-y-2 border-t border-black/[0.06] pt-2">
      <input type="hidden" name="company_id" value={companyId} />

      <label className="label" htmlFor="attach-contact">
        Existing contact
      </label>
      <select id="attach-contact" name="contact_id" className="field" defaultValue="" required>
        <option value="" disabled>
          Choose someone…
        </option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {/* Title and email are how you tell two people with the same name
                apart, which is exactly the case this list is full of. */}
            {[contactName(c), c.title, c.email].filter(Boolean).join(' · ')}
          </option>
        ))}
      </select>

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <button className="btn-primary text-xs" disabled={pending}>
          {pending ? 'Adding…' : 'Add to this company'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost text-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}
