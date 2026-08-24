'use client';

import { useEffect, useState } from 'react';
import { STATUS_LABELS, STATUSES, TIERS, displayName, type Profile } from '@/lib/types';

/**
 * Sticky bar for acting on checked companies.
 *
 * The checkboxes live in the surrounding <form>, so both buttons are ordinary
 * submits and everything works without JavaScript. This component only adds the
 * niceties: a live count, select-all, and hiding itself when nothing is picked.
 */
export function BulkBar({
  members,
  formId,
}: {
  members: Pick<Profile, 'id' | 'full_name' | 'email'>[];
  formId: string;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    const recount = () =>
      setCount(form.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked').length);

    form.addEventListener('change', recount);
    recount();
    return () => form.removeEventListener('change', recount);
  }, [formId]);

  const setAll = (checked: boolean) => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    form
      .querySelectorAll<HTMLInputElement>('input[name="ids"]')
      .forEach((box) => (box.checked = checked));
    form.dispatchEvent(new Event('change', { bubbles: true }));
  };

  return (
    <div
      className={`sticky bottom-4 z-10 transition ${
        count === 0 ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="card flex flex-wrap items-center gap-2 border-black/15 p-3 shadow-lg">
        <span className="text-sm font-medium">
          {count} selected
        </span>

        <button
          type="button"
          onClick={() => setAll(false)}
          className="text-xs text-black/45 hover:text-ink"
        >
          Clear
        </button>

        <span className="mx-1 h-5 w-px bg-black/10" />

        <select name="owner_id" defaultValue="" aria-label="Assign to" className="field w-40 py-1.5">
          <option value="">Unassign</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {displayName(m)}
            </option>
          ))}
        </select>
        <button name="op" value="assign" className="btn-ghost py-1.5">
          Assign
        </button>

        <span className="mx-1 h-5 w-px bg-black/10" />

        <select name="status" defaultValue="contacted" aria-label="Set status" className="field w-40 py-1.5">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button name="op" value="status" className="btn-ghost py-1.5">
          Set status
        </button>

        <span className="mx-1 h-5 w-px bg-black/10" />

        {/* Re-tiering in bulk is the point: triage happens to a batch of
            companies at once, not one at a time. */}
        <select name="tier" defaultValue="Tier 2" aria-label="Set tier" className="field w-32 py-1.5">
          <option value="">Unrated</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button name="op" value="tier" className="btn-ghost py-1.5">
          Set tier
        </button>
      </div>
    </div>
  );
}

/** Select-all control, rendered in the list header. */
export function SelectAll({ formId }: { formId: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const form = document.getElementById(formId) as HTMLFormElement | null;
        if (!form) return;
        const boxes = form.querySelectorAll<HTMLInputElement>('input[name="ids"]');
        const allChecked = [...boxes].every((b) => b.checked);
        boxes.forEach((b) => (b.checked = !allChecked));
        form.dispatchEvent(new Event('change', { bubbles: true }));
      }}
      className="text-xs text-black/45 hover:text-ink"
    >
      Select all on page
    </button>
  );
}
