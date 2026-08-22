import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import { MapShell } from '@/components/map-shell';
import type { MapPoint } from '@/components/company-map';

export const dynamic = 'force-dynamic';

type Row = {
  name: string;
  city: string | null;
  region: string | null;
  tier: string | null;
  latitude: number | null;
  longitude: number | null;
};

export default async function MapPage() {
  const supabase = await serverClient();

  const { data, error } = await supabase
    .from('companies')
    .select('name, city, region, tier, latitude, longitude')
    .not('latitude', 'is', null)
    .limit(5000);

  const rows = (data ?? []) as Row[];

  // Group by coordinate: one pin per town, rather than 1,200 pins stacked on
  // top of each other.
  const byPlace = new Map<string, MapPoint>();
  for (const r of rows) {
    if (r.latitude === null || r.longitude === null) continue;
    const key = `${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`;

    let p = byPlace.get(key);
    if (!p) {
      p = {
        city: r.city ?? 'Unknown',
        region: r.region,
        latitude: r.latitude,
        longitude: r.longitude,
        total: 0,
        tier1: 0,
        tier2: 0,
        names: [],
      };
      byPlace.set(key, p);
    }

    p.total += 1;
    if (r.tier === 'Tier 1') p.tier1 += 1;
    if (r.tier === 'Tier 2') p.tier2 += 1;
    if (p.names.length < 8) p.names.push(r.name);
  }

  const points = [...byPlace.values()].sort((a, b) => b.total - a.total);

  const { count: totalCompanies } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true });

  const missing = (totalCompanies ?? 0) - rows.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Map</h1>
          <p className="mt-1 text-sm text-black/55">
            {rows.length.toLocaleString()} companies across {points.length} towns
            {missing > 0 && (
              <>
                {' '}
                · <span className="text-black/40">{missing} not yet located</span>
              </>
            )}
          </p>
        </div>
        <Link href="/companies?tier=Tier+1" className="btn-ghost">
          Tier 1 list
        </Link>
      </div>

      {error && <p className="text-sm text-rose-700">{error.message}</p>}

      {points.length === 0 ? (
        <div className="card px-5 py-12 text-center text-sm text-black/50">
          No companies have coordinates yet.
        </div>
      ) : (
        <MapShell points={points} />
      )}
    </div>
  );
}
