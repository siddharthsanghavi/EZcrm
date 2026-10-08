'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EventForm, type EditableEvent } from '@/components/event-form';

/**
 * The calendar's side panel: "Schedule something" by default, or the editor
 * for one event when the URL names it (?event=…). Closing the editor drops the
 * parameter rather than keeping local state, so the back button and a shared
 * link both behave.
 */
export function CalendarPanel({
  month,
  defaultDate,
  editing,
  canDelete,
  writable,
}: {
  month: string;
  defaultDate: string;
  editing: EditableEvent | null;
  canDelete: boolean;
  writable: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const close = () => router.push(`/calendar?month=${month}`);

  if (editing) {
    return (
      <section className="card p-5">
        <h2 className="text-sm font-semibold">{writable ? 'Edit' : editing.title}</h2>
        {writable ? (
          <div className="mt-3">
            <EventForm
              key={editing.id}
              event={editing}
              defaultDate={editing.date}
              canDelete={canDelete}
              onDone={close}
            />
          </div>
        ) : (
          <div className="mt-2 space-y-1 text-sm text-black/65">
            <p>{editing.date}{editing.start_time ? ` · ${editing.start_time}` : ' · all day'}</p>
            {editing.company && <p>{editing.company.name}</p>}
            {editing.location && <p>{editing.location}</p>}
            {editing.notes && <p className="whitespace-pre-wrap">{editing.notes}</p>}
            <button onClick={close} className="btn-ghost mt-2">Close</button>
          </div>
        )}
      </section>
    );
  }

  if (!writable) return null;

  return (
    <section className="card p-5">
      {adding ? (
        <>
          <h2 className="text-sm font-semibold">Schedule something</h2>
          <div className="mt-3">
            <EventForm defaultDate={defaultDate} onDone={() => setAdding(false)} />
          </div>
        </>
      ) : (
        <button onClick={() => setAdding(true)} className="btn-primary w-full">
          Schedule a tour or event
        </button>
      )}
    </section>
  );
}
