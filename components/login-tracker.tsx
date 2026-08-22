import { displayName, sinceLabel } from '@/lib/types';

export type LoginRow = {
  email: string | null;
  event: 'signed_in' | 'denied' | 'failed' | 'signed_out';
  method: string | null;
  reason: string | null;
  created_at: string;
  profiles?: { full_name: string | null; email: string } | null;
};

const METHOD_LABEL: Record<string, string> = {
  pkce: 'link in same browser',
  token_hash: 'link anywhere',
  implicit: 'token in URL',
  unknown: 'unknown',
};

/**
 * Sign-ins over the last week, next to the links that were requested to get
 * them.
 *
 * The headline is the shortfall. Links asked for minus sessions started is the
 * number of times someone wanted in and didn't get there — the failure the
 * login page apologises for at length but nothing has ever counted.
 */
export function LoginTracker({
  rows,
  linksRequested,
}: {
  rows: LoginRow[];
  /** 'sent' sign-in emails over the same window, from auth_email_requests. */
  linksRequested: number;
}) {
  const signedIn = rows.filter((r) => r.event === 'signed_in');
  const failed = rows.filter((r) => r.event === 'failed');
  const denied = rows.filter((r) => r.event === 'denied');

  // Per-day buckets, oldest first.
  const DAYS = 7;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const days = Array.from({ length: DAYS }, (_, i) => {
    const from = new Date(startOfToday.getTime() - (DAYS - 1 - i) * 864e5);
    const to = new Date(from.getTime() + 864e5);
    const inDay = (r: LoginRow) => {
      const t = new Date(r.created_at).getTime();
      return t >= from.getTime() && t < to.getTime();
    };
    return {
      date: from,
      ok: signedIn.filter(inDay).length,
      bad: failed.filter(inDay).length,
    };
  });

  const peak = Math.max(1, ...days.map((d) => d.ok + d.bad));

  // Failures by reason, worst first — this is what tells you whether to move
  // the Supabase email template to /auth/confirm.
  const byReason = [...failed.reduce((m, r) => {
    const key = r.reason ?? 'unknown';
    return m.set(key, (m.get(key) ?? 0) + 1);
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  const shortfall = linksRequested - signedIn.length;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/10 px-5 py-3">
        <h2 className="text-sm font-semibold">Sign-ins · last 7 days</h2>
        <span className="text-xs text-black/45">
          {signedIn.length} in
          {failed.length > 0 && <> · {failed.length} failed</>}
          {denied.length > 0 && <> · {denied.length} not on the allowlist</>}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-black/45">
          Nothing recorded yet. Sign-ins are counted from the moment this was added, so this fills
          in as people come and go.
        </p>
      ) : (
        <div className="px-5 py-4">
          <ol className="flex h-20 items-end gap-1.5">
            {days.map((d, i) => (
              <li
                key={i}
                className="group flex-1"
                title={`${d.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })} — ${d.ok} in${d.bad ? `, ${d.bad} failed` : ''}`}
              >
                <div className="flex h-20 flex-col justify-end">
                  {d.bad > 0 && (
                    <div
                      className="w-full rounded-t-sm bg-danger/70"
                      style={{ height: `${(d.bad / peak) * 100}%` }}
                    />
                  )}
                  <div
                    className={`w-full ${d.bad > 0 ? '' : 'rounded-t-sm'} bg-ink/70`}
                    style={{ height: `${(d.ok / peak) * 100}%` }}
                  />
                  {d.ok + d.bad === 0 && <div className="h-px w-full bg-black/10" />}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-1.5 flex justify-between text-[10px] text-black/35">
            {days.map((d, i) => (
              <span key={i} className="flex-1 text-center">
                {d.date.toLocaleDateString(undefined, { weekday: 'narrow' })}
              </span>
            ))}
          </div>

          {/* The number this whole panel exists for. */}
          <p className="mt-4 text-xs text-black/50">
            <strong>{linksRequested}</strong> link{linksRequested === 1 ? '' : 's'} requested,{' '}
            <strong>{signedIn.length}</strong> sign-in{signedIn.length === 1 ? '' : 's'}.{' '}
            {shortfall > 0 ? (
              <span className="text-warn">
                {shortfall} request{shortfall === 1 ? '' : 's'} didn&apos;t end in a session —
                someone wanted in and didn&apos;t get there.
              </span>
            ) : (
              <>Every link that was asked for got used.</>
            )}
          </p>

          {byReason.length > 0 && (
            <div className="mt-3 border-t border-black/[0.07] pt-3">
              <h3 className="text-xs font-medium text-black/45">Why sign-ins failed</h3>
              <ul className="mt-1.5 space-y-1">
                {byReason.slice(0, 4).map(([reason, n]) => (
                  <li key={reason} className="flex items-baseline gap-2 text-xs">
                    <span className="w-6 shrink-0 tabular-nums text-black/70">{n}×</span>
                    <span className="text-black/55">{reason}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-black/40">
                &ldquo;code verifier&rdquo; or PKCE failures mean links are being opened in a
                different browser than asked for them — normal, since mail apps use their own. If
                that dominates, point the Supabase email template at{' '}
                <code className="text-black/55">/auth/confirm</code>, which doesn&apos;t need the
                verifier cookie.
              </p>
            </div>
          )}

          {denied.length > 0 && (
            <p className="mt-3 border-t border-black/[0.07] pt-3 text-xs text-black/50">
              <strong>{denied.length}</strong> sign-in
              {denied.length === 1 ? '' : 's'} by someone not on the allowlist. That is the
              allowlist working — they saw an empty app, not your data.
            </p>
          )}

          <ul className="mt-3 space-y-1 border-t border-black/[0.07] pt-3">
            {rows.slice(0, 6).map((r, i) => (
              <li key={i} className="flex items-baseline gap-2 text-xs">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    r.event === 'signed_in'
                      ? 'bg-success'
                      : r.event === 'failed'
                        ? 'bg-danger'
                        : r.event === 'denied'
                          ? 'bg-warn'
                          : 'bg-black/20'
                  }`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-black/60">
                  {r.profiles ? displayName(r.profiles) : (r.email ?? 'unknown')}
                  <span className="text-black/35">
                    {' '}
                    · {r.event.replace('_', ' ')}
                    {r.method && r.method !== 'unknown' && <> · {METHOD_LABEL[r.method] ?? r.method}</>}
                  </span>
                </span>
                <span className="shrink-0 text-black/35">{sinceLabel(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
