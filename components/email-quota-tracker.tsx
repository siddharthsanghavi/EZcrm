'use client';

import { useEffect, useState } from 'react';
import { preciseAgo } from '@/lib/types';

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
 *
 * CLIENT COMPONENT ON PURPOSE. Rendered on the server this formatted every
 * label in the server's timezone — UTC on Vercel — so a 6pm sign-in showed up
 * under "10 PM" for anyone in Georgia. Times have to be computed where the
 * person reading them is. `now` is therefore resolved after mount, and the
 * first render is a skeleton so the server and client markup agree.
 */
export function EmailQuotaTracker({
  requests,
  quota,
}: {
  requests: QuotaRequest[];
  quota: number;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  const HOURS = 24;

  if (now === null) {
    return (
      <Frame subtitle="">
        <div className="h-24 animate-pulse rounded bg-black/[0.04]" />
      </Frame>
    );
  }

  // Aligned to the top of the local hour, not to "now minus n hours". A bar
  // labelled 6 PM must mean 6:00–7:00, otherwise it spans 5:52–6:52 and the
  // label is a lie.
  const topOfHour = new Date(now);
  topOfHour.setMinutes(0, 0, 0);

  const buckets = Array.from({ length: HOURS }, (_, i) => {
    const start = new Date(topOfHour.getTime() - (HOURS - 1 - i) * 3600_000);
    const end = new Date(start.getTime() + 3600_000);
    const inHour = requests.filter((r) => {
      const t = new Date(r.requested_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    });
    return {
      hour: start,
      sent: inHour.filter((r) => r.outcome !== 'failed').length,
      blocked: inHour.filter((r) => r.outcome === 'failed').length,
    };
  });

  const sentTotal = buckets.reduce((n, b) => n + b.sent, 0);
  const blockedTotal = buckets.reduce((n, b) => n + b.blocked, 0);
  const peak = Math.max(quota, ...buckets.map((b) => b.sent + b.blocked));
  const hitCeiling = buckets.filter((b) => b.sent >= quota).length;
  const lastSent = requests.find((r) => r.outcome !== 'failed');

  const subtitle = [
    `${sentTotal} sent`,
    blockedTotal > 0 ? `${blockedTotal} blocked` : null,
    lastSent ? `last ${preciseAgo(lastSent.requested_at, now)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Frame subtitle={subtitle}>
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
            const label = b.hour.toLocaleTimeString(undefined, { hour: 'numeric' });
            return (
              <li
                key={i}
                className="flex-1"
                title={`${label} — ${b.sent} sent${b.blocked ? `, ${b.blocked} blocked` : ''}`}
              >
                <div className="flex h-24 flex-col justify-end">
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
                  {b.sent + b.blocked === 0 && <div className="h-px w-full bg-black/10" />}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Every sixth hour, so the axis stays readable at 24 bars. */}
      <div className="mt-1.5 flex text-[10px] text-black/35">
        {buckets.map((b, i) => (
          <span key={i} className="flex-1 text-center">
            {i % 6 === 0 ? b.hour.toLocaleTimeString(undefined, { hour: 'numeric' }) : ''}
          </span>
        ))}
      </div>

      <p className="mt-3 text-xs text-black/50">
        The dashed line is the hourly ceiling of <strong>{quota}</strong>, shared by the whole club
        rather than allowed per person.{' '}
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
    </Frame>
  );
}

function Frame({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/10 px-5 py-3">
        <h2 className="text-sm font-semibold">Sign-in emails · last 24 hours</h2>
        <span className="text-xs text-black/45">{subtitle}</span>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
