'use client';

import { useActionState, useRef } from 'react';
import { saveContact } from '@/app/actions';

type State = { error?: string; ok?: boolean } | null;

type Props = {
  companyId?: string;
  companies?: { id: string; name: string }[];
  compact?: boolean;
};

export function ContactForm({ companyId, companies, compact = false }: Props) {
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const result = (await saveContact(formData)) ?? null;
    if (result?.ok) formRef.current?.reset();
    return result;
  }, null);

  return (
    <form ref={formRef} action={action} className="space-y-2">
      {companyId && <input type="hidden" name="company_id" value={companyId} />}

      {companies && (
        <select name="company_id" className="field" defaultValue="" aria-label="Company">
          <option value="">No company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex gap-2">
        <input name="first_name" required placeholder="First name *" className="field" />
        <input name="last_name" placeholder="Last name" className="field" />
      </div>

      <input name="title" placeholder="Title / role" className="field" />
      {/* Only where a company is already chosen: a division without a company
          is a label with nothing to group. Who they report to is set from the
          tree on the company page, where the other names are visible. */}
      {(companyId || companies) && (
        <input name="division" placeholder="Division (optional)" className="field" />
      )}
      <input name="email" type="email" placeholder="Email" className="field" />
      <input name="phone" placeholder="Phone" className="field" />

      {!compact && <textarea name="notes" rows={3} placeholder="Notes" className="field" />}

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}

      <button className="btn-ghost w-full" disabled={pending}>
        {pending ? 'Adding…' : 'Add contact'}
      </button>
    </form>
  );
}
