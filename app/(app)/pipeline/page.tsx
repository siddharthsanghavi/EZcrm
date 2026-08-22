import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import { PipelineChart, PipelineLinks, type Flow, type StageCount } from '@/components/pipeline-chart';
import { STATUS_LABELS, STATUSES, displayName, type Status } from '@/lib/types';

// Read fresh on every visit, so the chart reflects the current state rather
// than whatever was true when the page was last built.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PipelinePage() {
  const supabase = await serverClient();

  const [{ data: companies }, { data: events }, { data: members }] = await Promise.all([
    supabase.from('companies').select('status, owner_id').limit(5000),
    supabase
      .from('status_events')
      .select('from_status, to_status, changed_at, changed_by, companies(id, name), profiles(full_name, email)')
      .order('changed_at', { ascending: false })
      .limit(400),
    supabase.from('profiles').select('id, full_name, email').order('email'),
  ]);

  const rows = companies ?? [];

  const stages: StageCount[] = STATUSES.map((s) => ({
    status: s,
    count: rows.filter((r) => r.status === s).length,
  }));

  // Count real transitions. The seeded "entered at creation" rows have a null
  // from_status and are excluded, so an arrow only shows movement someone caused.
  const flowMap = new Map<string, number>();
  for (const e of events ?? []) {
    if (!e.from_status) continue;
    const k = `${e.from_status}>${e.to_status}`;
    flowMap.set(k, (flowMap.get(k) ?? 0) + 1);
  }
  const flows: Flow[] = [...flowMap].map(([k, count]) => {
    const [from, to] = k.split('>');
    return { from: from as Status, to: to as Status, count };
  });

  const recent = (events ?? []).filter((e) => e.from_status).slice(0, 12);

  // Who is carrying what.
  const byOwner = new Map<string, number>();
  for (const r of rows) byOwner.set(r.owner_id ?? 'none', (byOwner.get(r.owner_id ?? 'none') ?? 0) + 1);
  const memberList = members ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-sm text-black/55">
          Live view of where every company stands. Updates itself as statuses change.
        </p>
      </div>

      <PipelineChart stages={stages} flows={flows} />
      <PipelineLinks stages={stages} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">
            Recent status changes
          </h2>
          {recent.length > 0 ? (
            <ul className="divide-y divide-black/5">
              {recent.map((e, i) => {
                const co = e.companies as unknown as { id: string; name: string } | null;
                const who = e.profiles as unknown as { full_name: string | null; email: string } | null;
                return (
                  <li key={i} className="px-5 py-3 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      {co ? (
                        <Link href={`/companies/${co.id}`} className="font-medium hover:underline">
                          {co.name}
                        </Link>
                      ) : (
                        <span className="font-medium">(deleted)</span>
                      )}
                      <span className="shrink-0 text-xs text-black/40">
                        {new Date(e.changed_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-black/55">
                      {STATUS_LABELS[e.from_status as Status]} → {STATUS_LABELS[e.to_status as Status]}
                      {' · '}
                      <span className="text-black/40">{displayName(who)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-8 text-sm text-black/45">
              No status changes yet. Move a company along and it will appear here, with who did it.
            </p>
          )}
        </section>

        <section className="card overflow-hidden">
          <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">Who owns what</h2>
          <ul className="divide-y divide-black/5">
            {memberList.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <Link href={`/companies?owner=${m.id}`} className="hover:underline">
                  {displayName(m)}
                </Link>
                <span className="tabular-nums text-black/55">{byOwner.get(m.id) ?? 0}</span>
              </li>
            ))}
            <li className="flex items-center justify-between px-5 py-3 text-sm">
              <Link href="/companies?owner=none" className="text-black/50 hover:underline">
                Unassigned
              </Link>
              <span className="tabular-nums text-black/55">
                {(byOwner.get('none') ?? 0).toLocaleString()}
              </span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
