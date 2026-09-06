'use client';

import { useActionState, useRef, useState } from 'react';
import { logActivity } from '@/app/actions';

/** A week out, which is the honest default for "chase this". */
function inAWeek() {
  return new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
}
import { ACTIVITY_TYPES, type Contact } from '@/lib/types';

type State = { error?: string; ok?: boolean } | null;

export function ActivityComposer({
  companyId,
  contacts,
}: {
  companyId: string;
  contacts: Pick<Contact, 'id' | 'first_name' | 'last_name'>[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  const [followUp, setFollowUp] = useState(false);
  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const result = (await logActivity(formData)) ?? null;
    if (result?.ok) {
      formRef.current?.reset();
      setFollowUp(false);
    }
    return result;
  }, null);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="company_id" value={companyId} />

      <div className="flex flex-wrap gap-2">
        <select name="type" className="field w-32" aria-label="Activity type">
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t} className="capitalize">
              {t}
            </option>
          ))}
        </select>

        {contacts.length > 0 && (
          <select name="contact_id" className="field w-44" aria-label="Contact" defaultValue="">
            <option value="">No specific contact</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name} {c.last_name ?? ''}
              </option>
            ))}
          </select>
        )}

        <input
          type="date"
          name="occurred_at"
          defaultValue={new Date().toISOString().slice(0, 10)}
          className="field w-40"
          aria-label="Date"
        />
      </div>

      <input name="subject" placeholder="Subject — e.g. Sent sponsorship deck" className="field" />
      <textarea name="body" rows={3} placeholder="What happened? What's next?" className="field" />

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}

      <div className="flex justify-end">
        {/* Collapsed until wanted: most logs do not need one, and a second
            always-open form would make the common case feel like paperwork. */}
        {followUp ? (
          <div className="flex flex-wrap gap-2">
            <input
              name="follow_up"
              autoFocus
              placeholder="Next step — e.g. Chase the tour date"
              className="field flex-1"
            />
            <input
              name="follow_up_due"
              type="date"
              defaultValue={inAWeek()}
              aria-label="Follow-up due"
              className="field w-40"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFollowUp(true)}
            className="text-xs text-black/45 hover:text-ink"
          >
            + Add a follow-up task
          </button>
        )}

        <button className="btn-primary" disabled={pending}>
          {pending ? 'Logging…' : 'Log it'}
        </button>
      </div>
    </form>
  );
}
