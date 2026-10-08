import { NextResponse, type NextRequest } from 'next/server';
import Papa from 'papaparse';
import { currentProfile, selectAll, serverClient } from '@/lib/supabase';

const TABLES = {
  companies:
    'name, type, tier, status, interest, capabilities, phone, website, industry, employees, notes, created_at',
  contacts: 'first_name, last_name, email, phone, title, deal_role, notes, created_at, companies(name)',
  activities: 'type, subject, body, occurred_at, companies(name)',
  // A company's places are their own export now that there can be several of
  // them: flattening three plants back into one company row would drop two.
  locations: 'label, address, city, region, county, is_primary, created_at, companies(name)',
} as const;

export async function GET(request: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });

  const table = request.nextUrl.searchParams.get('table') ?? '';
  if (!(table in TABLES)) {
    return NextResponse.json({ error: 'Unknown table.' }, { status: 400 });
  }

  const supabase = await serverClient();
  // `locations` is the label in the URL and on the export screen; the table is
  // company_locations. Widened deliberately: resolving a four-way union of
  // table names against a four-way union of select strings is a cross product
  // supabase-js cannot represent (TS2590).
  const from: string = table === 'locations' ? 'company_locations' : table;
  // "Everything currently in the CRM" has to mean everything. `.limit(10000)`
  // here returned 1,000 rows of a 1,268-row directory, silently — see selectAll.
  const { data, error } = await selectAll<Record<string, unknown>>((lo, hi) =>
    supabase
      .from(from)
      .select(TABLES[table as keyof typeof TABLES] as string)
      .order('created_at')
      .range(lo, hi)
      .then((r) => ({ data: r.data as Record<string, unknown>[] | null, error: r.error })),
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Logged here rather than by a trigger, because an export is a SELECT and
  // there is nothing for a trigger to fire on. Taking a copy of the club's
  // whole contact list out of the building is exactly the act you want to be
  // able to point at later, so a failure to log it must not pass silently --
  // but it must not fail the download either, hence the awaited catch.
  const { error: logError } = await supabase.rpc('log_data_transfer', {
    p_action: 'exported',
    p_table: table,
    p_rows: data?.length ?? 0,
  });
  if (logError) console.error('Could not log export:', logError.message);

  // Flatten the joined company object into a plain `company` column, and guard
  // against CSV injection — a cell starting with = or + executes in Excel.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  const flat = rows.map((row) => {
    const { companies, ...rest } = row;
    const out: Record<string, unknown> = {
      ...rest,
      company: (companies as { name: string } | null)?.name ?? '',
    };

    for (const [key, value] of Object.entries(out)) {
      if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) out[key] = `'${value}`;
    }
    return out;
  });

  const csv = Papa.unparse(flat);
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ezcrm-${table}-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
