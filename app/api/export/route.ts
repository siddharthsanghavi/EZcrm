import { NextResponse, type NextRequest } from 'next/server';
import Papa from 'papaparse';
import { currentProfile, serverClient } from '@/lib/supabase';

const TABLES = {
  companies:
    'name, type, tier, status, interest, city, region, address, phone, website, industry, employees, notes, created_at',
  contacts: 'first_name, last_name, email, phone, title, notes, created_at, companies(name)',
  activities: 'type, subject, body, occurred_at, companies(name)',
} as const;

export async function GET(request: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });

  const table = request.nextUrl.searchParams.get('table') ?? '';
  if (!(table in TABLES)) {
    return NextResponse.json({ error: 'Unknown table.' }, { status: 400 });
  }

  const supabase = await serverClient();
  const { data, error } = await supabase
    .from(table)
    .select(TABLES[table as keyof typeof TABLES])
    .limit(10000);

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
