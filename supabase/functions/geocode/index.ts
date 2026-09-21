// Street-level geocoding, run by the app instead of by hand.
//
// WHY AN EDGE FUNCTION AND NOT THE DATABASE
// The `http` extension is installed and can reach most hosts, but TLS to
// geocoding.geo.census.gov fails from Postgres ("SSL_ERROR_SYSCALL") while the
// same request succeeds from Deno and from curl. So the HTTP call lives here.
// This is also the only place a service-role key is used — it never enters the
// Next.js app, which is what keeps "no service-role key in the app" true.
//
// WHY THE CENSUS BUREAU
// Free, no API key, no billing to forget about, 10,000 addresses per batch, and
// it is the authoritative source for US street geometry. It is US-only, which
// is irrelevant here. Nominatim stays the fallback for city-level lookups
// (scripts/geocode_cities.py) because its usage policy discourages bulk runs.
//
// VALIDATION IS THE POINT
// Every wrong geocode still arrives as a confident answer — a past run put a
// town several hundred kilometres out and reported a 100% hit rate. So a match
// is only written if it lands inside Georgia AND within MAX_DRIFT_KM of the
// town centre we already trust. Anything else is reported, not saved.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
const BENCHMARK = 'Public_AR_Current';

// Georgia, drawn generously.
const BBOX = { minLat: 30.30, maxLat: 35.05, minLon: -85.70, maxLon: -80.70 };
const MAX_DRIFT_KM = 40;
const DEFAULT_LIMIT = 150;

type Pending = {
  id: string;
  address: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};

const km = (aLat: number, aLon: number, bLat: number, bLon: number) =>
  111.045 * Math.sqrt((aLat - bLat) ** 2 + ((aLon - bLon) * Math.cos((aLat * Math.PI) / 180)) ** 2);

/** "6755 Shiloh Rd E, Alpharetta, GA 30005" -> its parts. */
function split(row: Pending) {
  const street = row.address.replace(/,\s*[^,]+,\s*GA\s*\d{5}.*$/i, '').trim();
  // Anchored to the end: an unanchored \d{5} matches the street number.
  const zip = row.address.match(/(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? '';
  return { street, city: row.city ?? '', zip };
}

/** Census batch CSV has no header: id, street, city, state, zip. */
const csvCell = (s: string) => `"${s.replace(/"/g, '')}"`;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const url = Deno.env.get('SUPABASE_URL')!;
  const auth = req.headers.get('Authorization') ?? '';

  // Authorise as the CALLER, not as the service role: this rewrites shared
  // records, so it is admin-only and RLS is not the thing being trusted.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: isAdmin, error: adminErr } = await asUser.rpc('is_admin');
  if (adminErr || !isAdmin) {
    return Response.json({ error: 'Admins only.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), 1000);

  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Locations, not companies: a company with three plants has three addresses
  // to place. See supabase/migrations/015_company_locations.sql.
  const { data: pending, error } = await db
    .from('company_locations')
    .select('id, address, city, latitude, longitude')
    .not('address', 'is', null)
    .not('address', 'ilike', '%verify%')
    .or('geo_precision.is.null,geo_precision.neq.address')
    .limit(limit);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (pending ?? []).filter((r) => /\d/.test(r.address ?? '')) as Pending[];
  if (rows.length === 0) {
    return Response.json({ processed: 0, updated: 0, remaining: 0, done: true });
  }

  const csv = rows
    .map((r) => {
      const { street, city, zip } = split(r);
      return [r.id, csvCell(street), csvCell(city), 'GA', zip].join(',');
    })
    .join('\n');

  const form = new FormData();
  form.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'addresses.csv');
  form.append('benchmark', BENCHMARK);

  const res = await fetch(CENSUS, { method: 'POST', body: form });
  if (!res.ok) {
    return Response.json({ error: `Census returned ${res.status}` }, { status: 502 });
  }

  const out = await res.text();
  const byId = new Map(rows.map((r) => [r.id, r]));

  let updated = 0;
  const unmatched: string[] = [];
  const suspect: { id: string; km: number }[] = [];

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    // id,"input","Match","Exact","matched","lon,lat",tigerId,side
    const cells = line.match(/("[^"]*"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, '')) ?? [];
    if (cells.length < 6 || cells[2] !== 'Match') {
      if (cells[0]) unmatched.push(cells[0]);
      continue;
    }

    const src = byId.get(cells[0]);
    if (!src) continue;

    const [lon, lat] = cells[5].split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) {
      suspect.push({ id: cells[0], km: -1 });
      continue;
    }

    // Confident but wrong: a match in the wrong town is still inside Georgia.
    if (src.latitude != null && src.longitude != null) {
      const drift = km(lat, lon, src.latitude, src.longitude);
      if (drift > MAX_DRIFT_KM) {
        suspect.push({ id: cells[0], km: Math.round(drift) });
        continue;
      }
    }

    const { error: upErr } = await db.rpc('set_location_point', {
      p_id: cells[0],
      p_lat: lat,
      p_lon: lon,
    });
    if (!upErr) updated++;
  }

  const { count: remaining } = await db
    .from('company_locations')
    .select('id', { count: 'exact', head: true })
    .not('address', 'is', null)
    .not('address', 'ilike', '%verify%')
    .or('geo_precision.is.null,geo_precision.neq.address');

  return Response.json({
    processed: rows.length,
    updated,
    unmatched: unmatched.length,
    suspect,
    remaining: remaining ?? 0,
    done: (remaining ?? 0) === 0,
  });
});
