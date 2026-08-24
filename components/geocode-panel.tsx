'use client';

import { useState } from 'react';
import { runGeocodeBatch, type GeocodeResult } from '@/app/geocode-actions';

/**
 * Runs the geocoder in batches, one after another, until nothing is left.
 *
 * Deliberately sequential rather than one big job: the Census batch endpoint is
 * a free public service, an Edge Function has a wall-clock limit, and a run
 * that dies half way through should leave completed work saved. Each batch
 * commits on its own, so stopping is always safe and resuming is just pressing
 * the button again.
 */
export function GeocodePanel({ pending }: { pending: number }) {
  const [left, setLeft] = useState(pending);
  const [running, setRunning] = useState(false);
  const [stop, setStop] = useState(false);
  const [done, setDone] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setStop(false);
    setError(null);

    let guard = 0; // never loop forever if the server stops making progress
    while (guard++ < 40) {
      const r: GeocodeResult = await runGeocodeBatch(100);

      if (r.error) {
        setError(r.error);
        break;
      }

      setDone((n) => n + r.updated);
      setSkipped((n) => n + (r.unmatched ?? 0));
      setLeft(r.remaining);

      if (r.done || r.processed === 0) break;
      if (stop) break;
    }

    setRunning(false);
  }

  const total = pending || 1;
  const progress = Math.min(100, Math.round(((pending - left) / total) * 100));

  return (
    <section className="card p-6">
      <h2 className="text-sm font-semibold">Improve map locations</h2>
      <p className="mt-1 text-sm leading-relaxed text-black/60">
        Most pins sit on the centre of their town, which can be several kilometres from the actual
        building. This looks up the street address with the US Census geocoder and moves the pin —
        free, and it only saves a result that lands in Georgia and close to the town we already had.
      </p>

      {left > 0 ? (
        <p className="mt-3 text-sm">
          <strong className="tabular-nums">{left.toLocaleString()}</strong> companies have a street
          address that hasn&apos;t been looked up yet.
        </p>
      ) : (
        <p className="mt-3 text-sm text-success">
          Every company with a street address is pinned to it.
        </p>
      )}

      {(running || done > 0) && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.07]">
            <div
              className="h-1.5 rounded-full bg-accent transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-black/50">
            {done.toLocaleString()} moved to their street
            {skipped > 0 && <> · {skipped.toLocaleString()} the geocoder couldn&apos;t match</>}
            {running && <> · working…</>}
          </p>
        </div>
      )}

      {error && <p className="mt-3 rounded-md bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button onClick={run} disabled={running || left === 0} className="btn-primary">
          {running ? 'Looking up…' : left === 0 ? 'Nothing to do' : 'Start'}
        </button>
        {running && (
          <button onClick={() => setStop(true)} className="btn-ghost">
            Stop after this batch
          </button>
        )}
      </div>

      <p className="mt-3 text-xs text-black/40">
        Safe to stop and resume — each batch is saved as it finishes. Companies whose address is
        still &ldquo;(verify address)&rdquo; can&apos;t be improved until someone fills the address in.
      </p>
    </section>
  );
}
