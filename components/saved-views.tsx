'use client';

import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';
import { deleteSavedView, saveView } from '@/app/actions';
import { viewHref, type SavedView } from '@/lib/views';

type State = { error?: string; ok?: boolean } | null;

/**
 * Saved filter combinations, as chips.
 *
 * The chips are plain links, so a view is shareable by copying the address bar
 * — which is most of the point. Only the save form needs JavaScript, and only
 * to collapse itself again afterwards.
 */
export function SavedViews({
  views,
  path,
  currentQuery,
  myId,
  canSave = true,
}: {
  views: SavedView[];
  path: string;
  /** Already normalised by the page, so it compares like-for-like. */
  currentQuery: string;
  myId: string;
  /** Viewers follow saved views but do not create or delete them. */
  canSave?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const result = (await saveView(formData)) ?? null;
    if (result?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
    return result;
  }, null);

  const mine = views.filter((v) => v.path === path);

  // Nothing saved and nothing filtered is the one case worth hiding entirely,
  // so a fresh install doesn't show an empty control with no way to use it.
  if (mine.length === 0 && (!canSave || (!currentQuery && !open))) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-black/40">Views</span>

      {mine.map((view) => {
        const active = view.query === currentQuery;
        return (
          <span
            key={view.id}
            className={`group inline-flex items-center rounded-full text-xs font-medium transition ${
              active ? 'bg-ink text-white' : 'bg-black/[0.05] text-black/60 hover:bg-black/10'
            }`}
          >
            <Link href={viewHref(view.path, view.query)} className="py-1 pl-2.5 pr-1.5">
              {view.name}
              {!view.shared && (
                <span className={active ? 'text-white/50' : 'text-black/35'} title="Only you">
                  {' '}
                  ·
                </span>
              )}
            </Link>

            {canSave && view.owner_id === myId && (
              <form action={deleteSavedView} className="flex">
                <input type="hidden" name="id" value={view.id} />
                <button
                  aria-label={`Delete view ${view.name}`}
                  title="Delete this view"
                  className={`rounded-r-full py-1 pl-0.5 pr-2 opacity-0 transition group-hover:opacity-100 ${
                    active ? 'hover:text-white' : 'hover:text-danger'
                  }`}
                >
                  ×
                </button>
              </form>
            )}
          </span>
        );
      })}

      {canSave && currentQuery && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-dashed border-black/20 px-2.5 py-1 text-xs
                     font-medium text-black/45 transition hover:border-black/40 hover:text-ink"
        >
          + Save this view
        </button>
      )}

      {canSave && open && (
        <form ref={formRef} action={action} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="path" value={path} />
          <input type="hidden" name="query" value={currentQuery} />

          <input
            name="name"
            required
            autoFocus
            placeholder="Name this view"
            className="field w-44 py-1 text-xs"
          />

          <label className="flex items-center gap-1 text-xs text-black/50">
            <input
              type="checkbox"
              name="shared"
              defaultChecked
              className="h-3.5 w-3.5 rounded border-black/25"
            />
            Share
          </label>

          <button className="btn-primary px-2.5 py-1 text-xs" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-black/40 hover:text-ink"
          >
            Cancel
          </button>

          {state?.error && <span className="text-xs text-danger">{state.error}</span>}
        </form>
      )}
    </div>
  );
}
