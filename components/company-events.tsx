'use client';

import { useState } from 'react';
import Link from 'next/link';
import { EventForm, type EditableEvent } from '@/components/event-form';
import { EVENT_KIND_DOTS, EVENT_KIND_LABELS } from '@/lib/types';

/** An event for this list, with its labels already rendered in the club's zone. */
export type CompanyEventRow = EditableEvent & {
  dayLabel: string;
  timeLabel: string;
  past: boolean;
  canDelete: boolean;
};

/**
 * Tours and meetings with one company: what is coming, and the last few that
 * happened. Scheduling from here fixes the company and offers its contacts as
 * the host, which is the whole reason to do it here rather than on /calendar.
 */
export function CompanyEvents({
  company,
  contacts,
  events,
  today,
  writable,
}: {
  company: { id: string; name: string };
  contacts: { id: string; first_name: string; last_name: string | null }[];
  events: CompanyEventRow[];
  today: string;
  writable: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const upcoming = events.filter((e) => !e.past);
  const past = events.filter((e) => e.past).slice(-3).reverse();

  const row = (e: CompanyEventRow) =>
    editing === e.id ? (
      <li key={e.id} className="px-5 py-3">
        <EventForm
          fixedCompany={company}
          contacts={contacts}
          event={e}
          defaultDate={e.date}
          canDelete={e.canDelete}
          onDone={() => setEditing(null)}
        />
      </li>
    ) : (
      <li key={e.id} className={`flex items-baseline gap-3 px-5 py-3 text-sm ${e.past ? 'text-black/45' : ''}`}>
        <span aria-hidden className={`h-2 w-2 shrink-0 self-center rounded-full ${EVENT_KIND_DOTS[e.kind]}`} />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{e.title}</span>
          <span className="block text-xs text-black/45">
            {EVENT_KIND_LABELS[e.kind]} · {e.dayLabel} · {e.timeLabel}
            {e.location ? ` · ${e.location}` : ''}
          </span>
        </span>
        {writable && (
          <button onClick={() => setEditing(e.id)} className="shrink-0 text-xs text-black/40 hover:text-ink">
            Edit
          </button>
        )}
      </li>
    );

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
        <h2 className="text-sm font-semibold">Tours &amp; meetings</h2>
        <Link href="/calendar" className="text-xs text-black/45 hover:text-ink">
          Calendar →
        </Link>
      </div>

      {upcoming.length === 0 && past.length === 0 && !adding && (
        <p className="px-5 py-4 text-sm text-black/45">Nothing scheduled with {company.name} yet.</p>
      )}

      {upcoming.length > 0 && <ul className="divide-y divide-black/5">{upcoming.map(row)}</ul>}

      {past.length > 0 && (
        <>
          <div className="bg-black/[0.02] px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-black/40">
            Recent
          </div>
          <ul className="divide-y divide-black/5">{past.map(row)}</ul>
        </>
      )}

      {writable && (
        <div className="border-t border-black/10 p-4">
          {adding ? (
            <EventForm
              fixedCompany={company}
              contacts={contacts}
              defaultDate={today}
              onDone={() => setAdding(false)}
            />
          ) : (
            <button onClick={() => setAdding(true)} className="btn-ghost w-full">
              Schedule a tour or meeting
            </button>
          )}
        </div>
      )}
    </section>
  );
}
