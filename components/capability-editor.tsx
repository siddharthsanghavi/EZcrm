'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { setCapabilities } from '@/app/actions';
import { normalizeTag } from '@/lib/types';

/**
 * What a company actually does — "CNC", "Robotics", "PLC: Allen-Bradley",
 * "AS9100" — as tags you can filter the directory by.
 *
 * Suggestions are the tags already in use, so the vocabulary converges instead
 * of forking into "CNC", "cnc machining" and "CNC Machining". The server
 * reuses an existing spelling on a case-insensitive match as a second line of
 * defence. Each change saves immediately; there is no separate Save to forget.
 */
export function CapabilityEditor({
  companyId,
  initial,
  suggestions,
  writable,
}: {
  companyId: string;
  initial: string[];
  suggestions: string[];
  writable: boolean;
}) {
  const [tags, setTags] = useState(initial);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (next: string[]) => {
    const previous = tags;
    setTags(next);
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set('company_id', companyId);
      fd.set('tags', JSON.stringify(next));
      const result = await setCapabilities(fd);
      if (result?.error) {
        setTags(previous);
        setError(result.error);
      } else if (result?.tags) {
        setTags(result.tags);
      }
    });
  };

  const add = () => {
    const tag = normalizeTag(draft);
    setDraft('');
    if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    save([...tags, tag]);
  };

  const offered = suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 && !writable && <span className="text-sm text-black/40">None recorded.</span>}
        {tags.map((t) => (
          <span key={t} className="chip inline-flex items-center gap-1 bg-black/[0.05] text-black/70">
            <Link href={`/companies?cap=${encodeURIComponent(t)}`} className="hover:underline">
              {t}
            </Link>
            {writable && (
              <button
                type="button"
                onClick={() => save(tags.filter((x) => x !== t))}
                className="text-black/35 hover:text-danger"
                aria-label={`Remove ${t}`}
                disabled={pending}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {writable && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            list={`capabilities-${companyId}`}
            placeholder="Add a capability — CNC, robotics, AS9100…"
            className="field py-1.5 text-sm"
            aria-label="Add a capability"
            maxLength={40}
          />
          <datalist id={`capabilities-${companyId}`}>
            {offered.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button className="btn-ghost py-1.5 text-xs" disabled={pending || !draft.trim()}>
            Add
          </button>
        </form>
      )}

      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
