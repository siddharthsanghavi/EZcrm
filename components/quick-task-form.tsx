'use client';

import { useActionState, useRef } from 'react';
import { saveTask } from '@/app/actions';

type State = { error?: string; ok?: boolean } | null;

export function QuickTaskForm({ companyId }: { companyId?: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const result = (await saveTask(formData)) ?? null;
    if (result?.ok) formRef.current?.reset();
    return result;
  }, null);

  return (
    <form ref={formRef} action={action} className="space-y-2">
      {companyId && <input type="hidden" name="company_id" value={companyId} />}

      <input name="title" required placeholder="Follow up with…" className="field" />

      <div className="flex gap-2">
        <input type="date" name="due_date" className="field" aria-label="Due date" />
        <button className="btn-ghost shrink-0" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {state?.error && <p className="text-sm text-rose-700">{state.error}</p>}
    </form>
  );
}
