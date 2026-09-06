import Link from 'next/link';
import { currentProfile, serverClient } from '@/lib/supabase';
import { loadRottingRules } from '@/lib/settings';
import { PipelineBoard, type BoardCompany } from '@/components/pipeline-board';
import { PipelineChart, PipelineLinks, type Flow, type StageCount } from '@/components/pipeline-chart';
import {
  STATUS_LABELS,
  STATUSES,
  STATUS_PROBABILITY,
  canWrite,
  displayName,
  isCold,
  money,
  type Status,
} from '@/lib/types';

// Read fresh on every visit, so the chart reflects the current state rather
// than whatever was true when the page was last built.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PipelinePage() {
  const supabase = await serverClient();

  const [{ data: companies }, { data: events }, { data: members }] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, status, owner_id, city, tier, amount, last_touch_at, archived_at, profiles!companies_owner_id_fkey(full_name, email)')
      .is('archived_at', null)
      .order('name')
      .limit(5000),
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

  const [me, rotting] = await Promise.all([currentProfile(), loadRottingRules()]);

  // Money, weighted by how likely each stage is to land. Committed counts in
  // full; declined and dormant count for nothing.
  const weighted = rows.reduce(
    (sum, r) => sum + (Number(r.amount ?? 0) * STATUS_PROBABILITY[r.status as Status]),
    0,
  );
  const committed = rows
    .filter((r) => r.status === 'committed')
    .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  const anyMoney = rows.some((r) => r.amount !== null);

  const board: BoardCompany[] = rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    status: r.status as Status,
    city: (r.city as string | null) ?? null,
    tier: (r.tier as string | null) ?? null,
    amount: r.amount === null ? null : Number(r.amount),
    last_touch_at: (r.last_touch_at as string | null) ?? null,
    owner: displayName(r.profiles as unknown as { full_name: string | null; email: string } | null),
    cold: isCold(r.status as Status, r.last_touch_at as string | null, rotting),
  }));

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

      {anyMoney && (
        <section className="card flex flex-wrap items-baseline gap-x-8 gap-y-2 p-5">
          <div>
            <div className="text-xs text-black/45">Weighted pipeline</div>
            <div className="text-xl font-semibold tabular-nums">{money(weighted)}</div>
          </div>
          <div>
            <div className="text-xs text-black/45">Committed</div>
            <div className="text-xl font-semibold tabular-nums text-accent">{money(committed)}</div>
          </div>
          <p className="max-w-sm text-xs text-black/40">
            Weighted by stage: a prospect counts for 5%, a conversation 40%, a commitment in full.
            Round numbers on purpose — nobody here has the outcomes it would take to tune them.
          </p>
        </section>
      )}

      <PipelineBoard companies={board} writable={canWrite(me)} />

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
