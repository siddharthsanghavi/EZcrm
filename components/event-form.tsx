'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { deleteEvent, saveEvent } from '@/app/actions';
import { EVENT_KINDS, EVENT_KIND_LABELS, type EventKind } from '@/lib/types';
import type { SearchHit } from '@/app/api/search/route';

type State = { error?: string; ok?: boolean } | null;

/** An event being edited, with its date and times already in the club's zone. */
export type EditableEvent = {
  id: string;
  kind: EventKind;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  company: { id: string; name: string } | null;
  contact_id: string | null;
  location: string | null;
  notes: string | null;
};

/**
 * Schedule, or change, a tour, meeting, club event or deadline.
 *
 * On a company page the company is fixed and its contacts are offered as the
 * host. On the calendar it is optional — a careers fair belongs to no company —
 * and picked by searching, so the browser never receives all 1,267 names.
 *
 * Times are the club's wall clock; the server converts them (see saveEvent).
 */
export function EventForm({
  fixedCompany,
  contacts = [],
  event,
  defaultDate,
  canDelete = false,
  onDone,
}: {
  fixedCompany?: { id: string; name: string };
  contacts?: { id: string; first_name: string; last_name: string | null }[];
  event?: EditableEvent;
  defaultDate: string;
  canDelete?: boolean;
  onDone?: () => void;
}) {
  const [company, setCompany] = useState(fixedCompany ?? event?.company ?? null);
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState<State, FormData>(async (_prev, fd) => {
    const result = (await saveEvent(fd)) ?? null;
    if (result?.ok) {
      if (!event) formRef.current?.reset();
      onDone?.();
    }
    return result;
  }, null);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <form ref={formRef} action={action} className="space-y-2">
      {event && <input type="hidden" name="id" value={event.id} />}
      <input type="hidden" name="company_id" value={company?.id ?? ''} />

      <div className="flex flex-wrap gap-2">
        <select
          name="kind"
          defaultValue={event?.kind ?? 'tour'}
          className="field w-32"
          aria-label="Kind"
        >
          {EVENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {EVENT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <input
          name="title"
          required
          defaultValue={event?.title ?? ''}
          placeholder={fixedCompany ? `Plant tour at ${fixedCompany.name}` : 'Plant tour, careers fair…'}
          className="field min-w-0 flex-1"
          aria-label="Title"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          name="date"
          required
          defaultValue={event?.date ?? defaultDate}
          className="field w-40"
          aria-label="Date"
        />
        <input
          type="time"
          name="start_time"
          defaultValue={event?.start_time ?? ''}
          className="field w-32"
          aria-label="Starts"
        />
        <span className="self-center text-xs text-black/40">to</span>
        <input
          type="time"
          name="end_time"
          defaultValue={event?.end_time ?? ''}
          className="field w-32"
          aria-label="Ends"
        />
      </div>
      <p className="text-xs text-black/40">Leave the start time blank for an all-day entry.</p>

      {!fixedCompany && <CompanyPicker value={company} onChange={setCompany} />}

      {fixedCompany && contacts.length > 0 && (
        <select
          name="contact_id"
          defaultValue={event?.contact_id ?? ''}
          className="field"
          aria-label="Host"
        >
          <option value="">No specific host</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              Host: {c.first_name} {c.last_name ?? ''}
            </option>
          ))}
        </select>
      )}

      <input
        name="location"
        defaultValue={event?.location ?? ''}
        placeholder="Where — the plant, Zoom, room 204"
        className="field"
        aria-label="Location"
      />
      <textarea
        name="notes"
        rows={2}
        defaultValue={event?.notes ?? ''}
        placeholder="Group size, PPE, NDA, parking, who's driving…"
        className="field"
        aria-label="Notes"
      />

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {deleteError && <p className="text-sm text-danger">{deleteError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? 'Saving…' : event ? 'Save' : 'Schedule'}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="btn-ghost">
            Cancel
          </button>
        )}
        {event && canDelete && (
          <button
            type="button"
            disabled={deleting}
            className="ml-auto text-xs text-black/40 hover:text-danger"
            onClick={async () => {
              if (!confirm(`Cancel "${event.title}"?`)) return;
              setDeleting(true);
              setDeleteError(null);
              const fd = new FormData();
              fd.set('id', event.id);
              const result = await deleteEvent(fd);
              setDeleting(false);
              if (result?.error) setDeleteError(result.error);
              else onDone?.();
            }}
          >
            {deleting ? 'Removing…' : 'Remove from calendar'}
          </button>
        )}
      </div>
    </form>
  );
}

/** Find a company by name through /api/search; optional, clearable. */
function CompanyPicker({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (c: { id: string; name: string } | null) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    // Debounced, and a stale response never overwrites a fresher one.
    let live = true;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`).catch(() => null);
      const body = res?.ok ? ((await res.json()) as { hits: SearchHit[] }) : { hits: [] };
      if (live) setHits(body.hits.filter((h) => h.kind === 'company'));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-black/45">Company:</span>
        <span className="font-medium">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-black/40 hover:text-ink">
          change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Company (optional) — start typing a name"
        className="field"
        aria-label="Company"
      />
      {hits.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-black/10 bg-white shadow-sm">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ id: h.id, name: h.label });
                  setQ('');
                  setHits([]);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-black/[0.04]"
              >
                {h.label}
                {h.detail && <span className="ml-2 text-xs text-black/40">{h.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
