import Link from 'next/link';
import { selectAll, serverClient } from '@/lib/supabase';
import { MapShell } from '@/components/map-shell';
import type { MapPin } from '@/components/company-map';
import { STATUSES, TIERS, displayName, type Status } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Search = { tier?: string; status?: string; owner?: string };

export default async function MapPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { tier, status, owner } = await searchParams;
  const supabase = await serverClient();

  type Row = {
    id: string;
    company_id: string;
    label: string | null;
    city: string | null;
    county: string | null;
    area: string | null;
    region: string | null;
    latitude: number;
    longitude: number;
    geo_precision: string | null;
    companies: {
      name: string;
      type: string | null;
      tier: string | null;
      status: string;
      owner_id: string | null;
      profiles: { full_name: string | null; email: string } | null;
    };
  };

  // The map is a map of places, so it reads locations and joins the company on,
  // rather than the other way round. `!inner` is right here: a location with no
  // company is not a thing, and the filters below are company filters.
  // Built per page rather than once: `selectAll` walks ranges, and a query
  // builder cannot have `.range()` applied twice. A map with a thousand-pin
  // ceiling is a map that quietly leaves out the newest sites.
  const page = (from: number, to: number) => {
    let query = supabase
      .from('company_locations')
      .select(
        // One literal: supabase-js parses the select string as a type.
        'id, company_id, label, city, county, area, region, latitude, longitude, geo_precision, companies!inner(id, name, type, tier, status, owner_id, profiles!companies_owner_id_fkey(full_name, email))',
      )
      .not('latitude', 'is', null)
      .order('id')
      .range(from, to);

    if (tier) query = query.eq('companies.tier', tier);
    if (status && STATUSES.includes(status as Status)) query = query.eq('companies.status', status);
    if (owner === 'none') query = query.is('companies.owner_id', null);
    else if (owner) query = query.eq('companies.owner_id', owner);
    return query.then((r) => ({ data: r.data as unknown as Row[] | null, error: r.error }));
  };

  const [{ data, error }, { count: totalCount }, { count: locatedCount }, { data: members }] =
    await Promise.all([
      selectAll<Row>(page),
      supabase.from('companies').select('id', { count: 'exact', head: true }),
      // Companies with at least one located place. `!inner` would count a
      // company once per location, so the distinct count comes from the parent
      // side of the join instead.
      supabase
        .from('companies')
        .select('id, company_locations!inner(id)', { count: 'exact', head: true })
        .not('company_locations.latitude', 'is', null),
      supabase.from('profiles').select('id, full_name, email').order('email'),
    ]);

  const pins: MapPin[] = (data ?? []).map((r) => ({
    id: r.id,
    companyId: r.company_id,
    name: r.companies.name,
    place: r.label,
    city: r.city,
    county: r.county,
    area: r.area,
    region: r.region,
    type: r.companies.type,
    tier: r.companies.tier,
    status: r.companies.status,
    owner: r.companies.owner_id ? displayName(r.companies.profiles) : null,
    latitude: r.latitude,
    longitude: r.longitude,
    precise: r.geo_precision === 'address',
  }));

  const missing = (totalCount ?? 0) - (locatedCount ?? 0);
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
            {new Set(pins.map((p) => p.companyId)).size.toLocaleString()} companies ·{' '}
            {pins.length.toLocaleString()} locations shown
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

      {pins.length === 0 ? (
        <div className="card px-5 py-12 text-center text-sm text-black/50">
          Nothing to show.{' '}
          <Link href="/map" className="underline">Clear filters</Link>
        </div>
      ) : (
        <MapShell pins={pins} />
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
