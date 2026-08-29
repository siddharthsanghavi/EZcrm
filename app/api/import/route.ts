import { NextResponse } from 'next/server';
import { currentProfile, serverClient } from '@/lib/supabase';
import { INTERESTS, STATUSES, type Status } from '@/lib/types';

const MAX_ROWS = 2000;

type Row = Record<string, string>;

const clean = (v: string | undefined) => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * Insert in batches. A 1300-row directory import in one statement is slow enough
 * to risk a gateway timeout; 500 at a time keeps each request comfortable.
 * Returns the number created, or an error message.
 */
async function insertChunked(
  supabase: Awaited<ReturnType<typeof serverClient>>,
  table: string,
  rows: Record<string, unknown>[],
): Promise<number | string> {
  let created = 0;

  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase
      .from(table)
      .insert(rows.slice(i, i + 500))
      .select('id');

    if (error) return error.message;
    created += data.length;
  }

  return created;
}

/**
 * One line in the feed for the whole import, alongside the per-row events the
 * triggers write. Both matter: the rows say what arrived, this says it was one
 * deliberate act by one person rather than an afternoon of typing.
 */
async function logImport(
  supabase: Awaited<ReturnType<typeof serverClient>>,
  table: string,
  rows: number,
) {
  if (rows === 0) return;
  const { error } = await supabase.rpc('log_data_transfer', {
    p_action: 'imported',
    p_table: table,
    p_rows: rows,
  });
  if (error) console.error('Could not log import:', error.message);
}

export async function POST(request: Request) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });

  const { table, rows } = (await request.json()) as { table: string; rows: Row[] };

  if (table !== 'companies' && table !== 'contacts') {
    return NextResponse.json({ error: 'Unknown table.' }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows supplied.' }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS}).` }, { status: 400 });
  }

  const supabase = await serverClient();
  const errors: string[] = [];
  let skipped = 0;

  if (table === 'companies') {
    const payload = rows.flatMap((row, i) => {
      const name = clean(row.name ?? row.company ?? row.company_name);
      if (!name) {
        skipped++;
        if (errors.length < 5) errors.push(`Row ${i + 2}: missing company name.`);
        return [];
      }

      const status = clean(row.status)?.toLowerCase().replace(/\s+/g, '_');
      const interest = (clean(row.interest) ?? '')
        .split(/[,;|]/)
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is (typeof INTERESTS)[number] => INTERESTS.includes(s as never));

      const employees = Number.parseInt(clean(row.employees) ?? '', 10);

      return [
        {
          name,
          website: clean(row.website ?? row.url),
          industry: clean(row.industry ?? row.specialty),
          status: STATUSES.includes(status as Status) ? (status as Status) : 'prospect',
          interest,
          notes: clean(row.notes),
          type: clean(row.type),
          tier: clean(row.tier ?? row.confidence),
          city: clean(row.city),
          region: clean(row.region),
          address: clean(row.address),
          phone: clean(row.phone),
          employees: Number.isFinite(employees) ? employees : null,
          created_by: profile.id,
        },
      ];
    });

    // Skip names already in the CRM so re-running an import tops up the list
    // rather than doubling it.
    const { data: existing } = await supabase.from('companies').select('name');
    const known = new Set((existing ?? []).map((c) => c.name.trim().toLowerCase()));

    const fresh = payload.filter((c) => {
      if (known.has(c.name.toLowerCase())) {
        skipped++;
        return false;
      }
      known.add(c.name.toLowerCase());
      return true;
    });

    const created = await insertChunked(supabase, 'companies', fresh);
    if (typeof created === 'string') return NextResponse.json({ error: created }, { status: 400 });

    await logImport(supabase, 'companies', created);
    return NextResponse.json({ created, skipped, errors });
  }

  // Contacts: resolve the optional `company` column to an id by name so an
  // imported list links up with companies you already track.
  const { data: companies } = await supabase.from('companies').select('id, name');
  const byName = new Map((companies ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));

  const payload = rows.flatMap((row, i) => {
    const first = clean(row.first_name ?? row.first ?? row.name);
    if (!first) {
      skipped++;
      if (errors.length < 5) errors.push(`Row ${i + 2}: missing first name.`);
      return [];
    }

    const companyName = clean(row.company ?? row.company_name ?? row.organisation);
    const companyId = companyName ? (byName.get(companyName.toLowerCase()) ?? null) : null;
    if (companyName && !companyId && errors.length < 5) {
      errors.push(`Row ${i + 2}: no company named "${companyName}" — imported unlinked.`);
    }

    return [
      {
        company_id: companyId,
        first_name: first,
        last_name: clean(row.last_name ?? row.last ?? row.surname),
        email: clean(row.email),
        phone: clean(row.phone ?? row.telephone ?? row.mobile),
        title: clean(row.title ?? row.role ?? row.job_title),
        notes: clean(row.notes),
        created_by: profile.id,
      },
    ];
  });

  const created = await insertChunked(supabase, 'contacts', payload);
  if (typeof created === 'string') return NextResponse.json({ error: created }, { status: 400 });

  await logImport(supabase, 'contacts', created);
  return NextResponse.json({ created, skipped, errors });
}
