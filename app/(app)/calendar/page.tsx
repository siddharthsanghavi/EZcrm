import Link from 'next/link';
import { currentProfile, serverClient } from '@/lib/supabase';
import { loadTimeZone } from '@/lib/settings';
import { CalendarPanel } from '@/components/calendar-panel';
import type { EditableEvent } from '@/components/event-form';
import {
  EVENT_KIND_DOTS,
  EVENT_KIND_LABELS,
  canWrite,
  dayLabelIn,
  monthGrid,
  timeLabelIn,
  todayIn,
  wallClockIn,
  type CalendarEvent,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

type Row = CalendarEvent & { companies: { id: string; name: string } | null };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Tours, meetings, club events and deadlines, a month at a time.
 *
 * Every date on this page is reckoned in the club's time zone (Settings →
 * Club). The grid is built from calendar dates, and each event is filed under
 * the date its start falls on in that zone — so a 9pm tour in Georgia sits on
 * its own day even though it is already tomorrow in UTC.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; event?: string }>;
}) {
  const { month, event: eventId } = await searchParams;
  const supabase = await serverClient();
  const [me, tz] = await Promise.all([currentProfile(), loadTimeZone()]);

  const grid = monthGrid(tz, month);
  const today = todayIn(tz);

  const [{ data, error }, { data: picked }] = await Promise.all([
    supabase
      .from('events')
      .select('id, company_id, contact_id, kind, title, starts_at, ends_at, location, notes, created_by, companies(id, name)')
      .gte('starts_at', grid.from.toISOString())
      .lt('starts_at', grid.to.toISOString())
      .order('starts_at'),
    eventId
      ? supabase
          .from('events')
          .select('id, company_id, contact_id, kind, title, starts_at, ends_at, location, notes, created_by, companies(id, name)')
          .eq('id', eventId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const events = (data ?? []) as unknown as Row[];
  const byDay = new Map<string, Row[]>();
  for (const e of events) {
    const day = wallClockIn(tz, e.starts_at).date;
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }

  const inMonth = (d: string) => d.slice(0, 7) === grid.month;
  const monthEvents = events.filter((e) => inMonth(wallClockIn(tz, e.starts_at).date));

  const allDay = (e: { starts_at: string }) => wallClockIn(tz, e.starts_at).time === '00:00';
  const when = (e: Row) =>
    allDay(e)
      ? 'All day'
      : `${timeLabelIn(tz, e.starts_at)}${e.ends_at ? `–${timeLabelIn(tz, e.ends_at)}` : ''}`;

  const sel = picked as unknown as Row | null;
  const editing: EditableEvent | null = sel
    ? {
        id: sel.id,
        kind: sel.kind,
        title: sel.title,
        date: wallClockIn(tz, sel.starts_at).date,
        start_time: allDay(sel) ? null : wallClockIn(tz, sel.starts_at).time,
        end_time: sel.ends_at ? wallClockIn(tz, sel.ends_at).time : null,
        company: sel.companies,
        contact_id: sel.contact_id,
        location: sel.location,
        notes: sel.notes,
      }
    : null;

  const writable = canWrite(me);
  const canDelete = Boolean(sel && (me?.role === 'admin' || sel.created_by === me?.id));
  const link = (e: Row) => `/calendar?month=${grid.month}&event=${e.id}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-black/55">
            {monthEvents.length} scheduled in {grid.label} · times in {tz.replace(/_/g, ' ')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/calendar?month=${grid.prev}`} className="btn-ghost" aria-label="Previous month">
            ←
          </Link>
          <Link href="/calendar" className="btn-ghost">
            Today
          </Link>
          <Link href={`/calendar?month=${grid.next}`} className="btn-ghost" aria-label="Next month">
            →
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error.message}</p>}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <section className="card overflow-hidden">
            <div className="border-b border-black/10 px-4 py-2.5 text-sm font-semibold">{grid.label}</div>
            <div className="grid grid-cols-7 border-b border-black/[0.06] text-center text-[11px] font-medium uppercase tracking-wide text-black/40">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1.5">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.weeks.flat().map((d) => {
                const dayEvents = byDay.get(d) ?? [];
                return (
                  <div
                    key={d}
                    className={`min-h-[5.5rem] border-b border-r border-black/[0.06] p-1.5 text-xs ${
                      inMonth(d) ? '' : 'bg-black/[0.02] text-black/35'
                    }`}
                  >
                    <div
                      className={`mb-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 tabular-nums ${
                        d === today ? 'bg-accent font-semibold text-white' : ''
                      }`}
                    >
                      {Number(d.slice(8))}
                    </div>
                    <ul className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((e) => (
                        <li key={e.id}>
                          <Link
                            href={link(e)}
                            title={`${EVENT_KIND_LABELS[e.kind]} · ${when(e)}${e.companies ? ` · ${e.companies.name}` : ''}`}
                            className="flex items-center gap-1 truncate rounded px-1 py-0.5 hover:bg-black/[0.05]"
                          >
                            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${EVENT_KIND_DOTS[e.kind]}`} />
                            <span className="truncate">{e.title}</span>
                          </Link>
                        </li>
                      ))}
                      {dayEvents.length > 3 && (
                        <li className="px-1 text-black/40">+{dayEvents.length - 3} more</li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {/* The grid is cramped on a phone; this is the same month as a list. */}
          <section className="card overflow-hidden">
            <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">{grid.label}, in order</h2>
            {monthEvents.length > 0 ? (
              <ul className="divide-y divide-black/5">
                {monthEvents.map((e) => (
                  <li key={e.id}>
                    <Link href={link(e)} className="flex items-baseline gap-3 px-5 py-3 text-sm hover:bg-black/[0.02]">
                      <span className="w-24 shrink-0 text-xs text-black/50">{dayLabelIn(tz, e.starts_at)}</span>
                      <span aria-hidden className={`h-2 w-2 shrink-0 self-center rounded-full ${EVENT_KIND_DOTS[e.kind]}`} />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{e.title}</span>
                        {e.companies && <span className="text-black/50"> · {e.companies.name}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-black/45">{when(e)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-black/45">Nothing scheduled this month.</p>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <CalendarPanel
            month={grid.month}
            defaultDate={inMonth(today) ? today : `${grid.month}-01`}
            editing={editing}
            canDelete={canDelete}
            writable={writable}
          />
          <section className="card p-5 text-xs text-black/55">
            <h2 className="mb-2 text-sm font-semibold text-ink">Key</h2>
            <ul className="space-y-1">
              {(Object.keys(EVENT_KIND_LABELS) as (keyof typeof EVENT_KIND_LABELS)[]).map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <span aria-hidden className={`h-2 w-2 rounded-full ${EVENT_KIND_DOTS[k]}`} />
                  {EVENT_KIND_LABELS[k]}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
