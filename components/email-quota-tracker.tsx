import { sinceLabel } from '@/lib/types';

export type QuotaRequest = {
  email: string;
  outcome: 'pending' | 'sent' | 'failed';
  requested_at: string;
};

/**
 * Sign-in emails per hour, for the last day.
 *
 * The point of the chart is not the total — it is spotting the hour where the
 * club hit the ceiling, because that is the hour somebody couldn't get in and
 * probably said nothing about it.
 */
export function EmailQuotaTracker({
  requests,
  quota,
}: {
  requests: QuotaRequest[];
  quota: number;
}) {
  const now = Date.now();
  const HOURS = 24;

  // Oldest bucket first, so the chart reads left to right like a timeline.
  const buckets = Array.from({ length: HOURS }, (_, i) => {
    const end = now - (HOURS - 1 - i) * 3600_000;
    const start = end - 3600_000;
    const inHour = requests.filter((r) => {
      const t = new Date(r.requested_at).getTime();
      return t > start && t <= end;
    });
    return {
      hour: new Date(end),
      sent: inHour.filter((r) => r.outcome !== 'failed').length,
      blocked: inHour.filter((r) => r.outcome === 'failed').length,
    };
  });

  const sentTotal = buckets.reduce((n, b) => n + b.sent, 0);
  const blockedTotal = buckets.reduce((n, b) => n + b.blocked, 0);
  const peak = Math.max(quota, ...buckets.map((b) => b.sent + b.blocked));
  const hitCeiling = buckets.filter((b) => b.sent >= quota).length;

  const lastSent = requests.find((r) => r.outcome !== 'failed');

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/10 px-5 py-3">
        <h2 className="text-sm font-semibold">Sign-in emails · last 24 hours</h2>
        <span className="text-xs text-black/45">
          {sentTotal} sent
          {blockedTotal > 0 && <> · {blockedTotal} blocked</>}
          {lastSent && <> · last {sinceLabel(lastSent.requested_at)}</>}
        </span>
      </div>

      <div className="px-5 py-4">
        <div className="relative">
          {/* The ceiling line is the whole story: bars touching it are hours
              when the next person to try was turned away. */}
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-warn/60"
            style={{ bottom: `${(quota / peak) * 100}%` }}
            aria-hidden
          />

          <ol className="flex h-24 items-end gap-[3px]">
            {buckets.map((b, i) => {
              const total = b.sent + b.blocked;
              const label = b.hour.toLocaleTimeString(undefined, { hour: 'numeric' });
              return (
                <li
                  key={i}
                  className="group relative flex-1"
                  title={`${label} — ${b.sent} sent${b.blocked ? `, ${b.blocked} blocked` : ''}`}
                >
                  <div className="flex flex-col justify-end" style={{ height: '6rem' }}>
                    {b.blocked > 0 && (
                      <div
                        className="w-full rounded-t-sm bg-danger/70"
                        style={{ height: `${(b.blocked / peak) * 100}%` }}
                      />
                    )}
                    <div
                      className={`w-full ${b.blocked > 0 ? '' : 'rounded-t-sm'} ${
                        b.sent >= quota ? 'bg-warn' : 'bg-ink/70'
                      }`}
                      style={{ height: `${(b.sent / peak) * 100}%` }}
                    />
                    {total === 0 && <div className="h-px w-full bg-black/10" />}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mt-1.5 flex justify-between text-[10px] text-black/35">
          <span>24h ago</span>
          <span>now</span>
        </div>

        <p className="mt-3 text-xs text-black/50">
          The dashed line is the hourly ceiling of <strong>{quota}</strong>, shared by the whole
          club rather than allowed per person.{' '}
          {hitCeiling > 0 ? (
            <span className="text-warn">
              {hitCeiling} hour{hitCeiling === 1 ? '' : 's'} reached it — anyone who tried to sign in
              then was turned away.
            </span>
          ) : (
            <>Nothing has come close in the last day.</>
          )}
        </p>

        {hitCeiling > 0 && (
          <p className="mt-2 text-xs text-black/45">
            Raising it means configuring a custom SMTP server in Supabase; the built-in sender
            can&apos;t be turned up. Until then the limit is real, and the app now refuses politely
            rather than spending the quota to get an error back.
          </p>
        )}
      </div>
    </section>
  );
}
