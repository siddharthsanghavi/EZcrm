'use client';

import Link from 'next/link';
import { useState } from 'react';
import { setCompanyStatus } from '@/app/actions';
import {
  STATUSES,
  STATUS_LABELS,
  money,
  sinceLabel,
  type Status,
} from '@/lib/types';

export type BoardCompany = {
  id: string;
  name: string;
  status: Status;
  city: string | null;
  tier: string | null;
  amount: number | null;
  last_touch_at: string | null;
  owner: string | null;
  cold: boolean;
};

/**
 * The pipeline as a board you can drag things across.
 *
 * The dropdown on a company page is fine for one deliberate change; this is for
 * the twenty minutes a term somebody spends moving the whole season along. HTML
 * drag and drop rather than a library: six columns of small cards is exactly
 * the case the native API handles, and a dependency here would cost more in
 * bundle than it saves in code.
 *
 * Cards move optimistically. A refusal from the database — "committed" needs a
 * contact and a date — puts the card back where it was and says why, because a
 * card that silently returns looks like a bug in the dragging.
 */
export function PipelineBoard({
  companies,
  writable,
}: {
  companies: BoardCompany[];
  writable: boolean;
}) {
  const [rows, setRows] = useState(companies);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  const move = async (id: string, to: Status) => {
    const card = rows.find((c) => c.id === id);
    if (!card || card.status === to) return;

    const from = card.status;
    setRows((list) => list.map((c) => (c.id === id ? { ...c, status: to } : c)));
    setError(null);

    const body = new FormData();
    body.set('id', id);
    body.set('status', to);

    const result = await setCompanyStatus(body);
    if (result?.error) {
      setRows((list) => list.map((c) => (c.id === id ? { ...c, status: from } : c)));
      setError(result.error.replace(/^.*?:\s*/, ''));
    }
  };

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid gap-3 overflow-x-auto md:grid-cols-3 xl:grid-cols-6">
        {STATUSES.map((status) => {
          const inStage = rows.filter((c) => c.status === status);
          const total = inStage.reduce((sum, c) => sum + (c.amount ?? 0), 0);

          return (
            <section
              key={status}
              onDragOver={(e) => {
                if (!writable || !dragging) return;
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver((s) => (s === status ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (writable && dragging) move(dragging, status);
                setDragging(null);
              }}
              className={`card min-h-[8rem] p-2 transition ${
                over === status ? 'border-accent bg-accent/[0.06]' : ''
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
                <span className="text-xs font-semibold">{STATUS_LABELS[status]}</span>
                <span className="text-xs tabular-nums text-black/40">{inStage.length}</span>
              </div>

              {total > 0 && (
                <div className="px-1 pb-2 text-[11px] tabular-nums text-black/40">
                  {money(total)}
                </div>
              )}

              <ul className="space-y-1.5">
                {inStage.map((c) => (
                  <li
                    key={c.id}
                    draggable={writable}
                    onDragStart={() => setDragging(c.id)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={`rounded-lg border border-black/[0.08] bg-paper p-2 text-xs transition ${
                      writable ? 'cursor-grab active:cursor-grabbing hover:border-black/20' : ''
                    } ${dragging === c.id ? 'opacity-40' : ''}`}
                  >
                    <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>

                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-black/45">
                      {c.city && <span>{c.city}</span>}
                      {c.amount !== null && (
                        <span className="tabular-nums text-black/60">{money(c.amount)}</span>
                      )}
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-black/40">{c.owner ?? 'Unassigned'}</span>
                      <span className={c.cold ? 'font-medium text-warn' : 'text-black/35'}>
                        {sinceLabel(c.last_touch_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="text-xs text-black/40">
        {writable
          ? 'Drag a company between columns to change its status.'
          : 'Read-only: your account cannot change statuses.'}
      </p>
    </div>
  );
}
