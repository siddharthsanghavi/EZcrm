import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import { MapShell } from '@/components/map-shell';
import type { MapCompany } from '@/components/company-map';
import { STATUSES, TIERS, displayName, type Status } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Search = { tier?: string; status?: string; owner?: string };

export default async function MapPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { tier, status, owner } = await searchParams;
  const supabase = await serverClient();

  let query = supabase
    .from('companies')
    .select(
      'id, name, city, county, area, region, type, tier, status, latitude, longitude, geo_precision, owner_id, profiles!companies_owner_id_fkey(full_name, email)',
    )
    .not('latitude', 'is', null)
    .limit(5000);

  if (tier) query = query.eq('tier', tier);
  if (status && STATUSES.includes(status as Status)) query = query.eq('status', status);
  if (owner === 'none') query = query.is('owner_id', null);
  else if (owner) query = query.eq('owner_id', owner);

  const [{ data, error }, { count: totalCount }, { data: members }] = await Promise.all([
    query,
    supabase.from('companies').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id, full_name, email').order('email'),
  ]);

  const companies: MapCompany[] = (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    city: r.city as string | null,
    county: r.county as string | null,
    area: r.area as string | null,
    region: r.region as string | null,
    type: r.type as string | null,
    tier: r.tier as string | null,
    status: r.status as string,
    owner: r.owner_id
      ? displayName(r.profiles as unknown as { full_name: string | null; email: string } | null)
      : null,
    latitude: r.latitude as number,
    longitude: r.longitude as number,
    precise: r.geo_precision === 'address',
  }));

  const missing = (totalCount ?? 0) - companies.length;
  const sp: Search = { tier, status, owner };
  const link = (key: keyof Search, value?: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== key) p.set(k, v);
    if (value) p.set(key, value);
    const qs = p.toString();
    return `/map${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Map</h1>
          <p className="mt-1 text-sm text-black/55">
            {companies.length.toLocaleString()} companies shown
            {missing > 0 && !tier && !status && !owner && (
              <> · <span className="text-black/40">{missing} without a location</span></>
            )}
          </p>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-1 p-3">
        <span className="mr-1 text-xs font-medium text-black/40">Tier</span>
        <Pill href={link('tier')} active={!tier}>Any</Pill>
        {TIERS.map((t) => (
          <Pill key={t} href={link('tier', t)} active={tier === t}>{t}</Pill>
        ))}

        <span className="ml-4 mr-1 text-xs font-medium text-black/40">Owner</span>
        <Pill href={link('owner')} active={!owner}>Anyone</Pill>
        {(members ?? []).map((m) => (
          <Pill key={m.id} href={link('owner', m.id)} active={owner === m.id}>
            {displayName(m)}
          </Pill>
        ))}
        <Pill href={link('owner', 'none')} active={owner === 'none'}>Unassigned</Pill>
      </div>

      {error && <p className="text-sm text-danger">{error.message}</p>}

      {companies.length === 0 ? (
        <div className="card px-5 py-12 text-center text-sm text-black/50">
          Nothing to show.{' '}
          <Link href="/map" className="underline">Clear filters</Link>
        </div>
      ) : (
        <MapShell companies={companies} />
      )}
    </div>
  );
}

function Pill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
        active ? 'bg-ink text-white' : 'bg-black/[0.05] text-black/60 hover:bg-black/10'
      }`}
    >
      {children}
    </Link>
  );
}
