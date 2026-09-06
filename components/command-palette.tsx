'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchHit } from '@/app/api/search/route';

/**
 * ⌘K / Ctrl-K, for when somebody says a company's name on a call.
 *
 * Finding a company otherwise means opening the list and filtering it, which is
 * fine with a plan and useless mid-sentence.
 *
 * Deliberately plain: no fuzzy ranking, no recent-items memory, no library. The
 * whole job is "type three letters, press Enter, land on the page", and every
 * one of those additions would cost more than it returns at this size.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setHits([]);
      setActive(0);
      // The input mounts with the dialog, so focus has to wait a frame.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setHits([]);
      return;
    }

    // Debounced, and every response checked against the query that is current
    // when it lands: without that, a slow answer for "pen" can overwrite a fast
    // one for "pennine" and the list flickers backwards as you type.
    const wanted = q;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(wanted)}`);
        const data = (await res.json()) as { hits?: SearchHit[] };
        setQ((current) => {
          if (current === wanted) {
            setHits(data.hits ?? []);
            setActive(0);
          }
          return current;
        });
      } catch {
        // Offline or a dropped request: leave the last results rather than
        // blanking the list under someone mid-type.
      } finally {
        setLoading(false);
      }
    }, 160);

    return () => clearTimeout(timer);
  }, [q, open]);

  if (!open) return null;

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    setOpen(false);
    router.push(hit.href);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="card w-full max-w-lg overflow-hidden p-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, hits.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              go(hits[active]);
            }
          }}
          placeholder="Search companies and contacts…"
          className="w-full border-0 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-black/35"
        />

        <div className="max-h-80 overflow-auto border-t border-black/[0.08]">
          {hits.length > 0 ? (
            <ul>
              {hits.map((hit, i) => (
                <li key={`${hit.kind}-${hit.id}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(hit)}
                    className={`flex w-full items-baseline justify-between gap-3 px-4 py-2 text-left text-sm ${
                      i === active ? 'bg-black/[0.05]' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{hit.label}</span>
                      {hit.detail && (
                        <span className="ml-2 text-xs text-black/45">{hit.detail}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-black/30">
                      {hit.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-black/40">
              {q.trim().length < 2
                ? 'Type at least two letters.'
                : loading
                  ? 'Searching…'
                  : 'Nothing matches.'}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-black/[0.08] px-4 py-2 text-[11px] text-black/35">
          <span>↑↓ to move · Enter to open · Esc to close</span>
          <span>⌘K</span>
        </div>
      </div>
    </div>
  );
}
