import { NextResponse } from 'next/server';
import { currentProfile, serverClient } from '@/lib/supabase';
import { findDuplicate, type DuplicateMatch } from '@/lib/dedupe';
import { INTERESTS, STATUSES, normalizeTag, type Status } from '@/lib/types';

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
/**
 * Returns the new rows' ids in insert order, so a caller can attach children to
 * them. PostgREST returns `select('id')` in the order the rows were sent, which
 * is what lets the company import place each row's location.
 */
async function insertChunked(
  supabase: Awaited<ReturnType<typeof serverClient>>,
  table: string,
  rows: Record<string, unknown>[],
): Promise<string[] | string> {
  const ids: string[] = [];

  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase
      .from(table)
      .insert(rows.slice(i, i + 500))
      .select('id');

    if (error) return error.message;
    for (const row of data) ids.push(row.id as string);
  }

  return ids;
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

  const { table, rows, dryRun, force } = (await request.json()) as {
    table: string;
    rows: Row[];
    dryRun?: boolean;
    force?: string[];
  };

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
          phone: clean(row.phone),
          employees: Number.isFinite(employees) ? employees : null,
          // "CNC; Robotics; AS9100" — semicolons or pipes, since a comma would
          // already have split the CSV cell.
          capabilities: [
            ...new Set(
              (clean(row.capabilities ?? row.tags) ?? '')
                .split(/[;|]/)
                .map(normalizeTag)
                .filter(Boolean),
            ),
          ],
          created_by: profile.id,
          // Not a column any more — carried alongside the row and peeled off
          // below into the company's primary location.
          place: {
            address: clean(row.address),
            city: clean(row.city),
            region: clean(row.region),
          },
        },
      ];
    });

    // Near matches, not just exact ones: "Pennine Print Works, Inc." and
    // "Pennine Print Works" are the same factory, and importing both forks the
    // directory in a way nobody notices for a term.
    const { data: existing } = await supabase.from('companies').select('id, name, website');
    const known = [...((existing ?? []) as { id: string; name: string; website: string | null }[])];

    // Rows the importer has already looked at and said "add it anyway".
    const forced = new Set(
      (Array.isArray(force) ? force : []).map((n) => String(n).trim().toLowerCase()),
    );

    const duplicates: { name: string; reason: DuplicateMatch['reason']; existing: string }[] = [];

    const fresh = payload.filter((c) => {
      if (forced.has(c.name.trim().toLowerCase())) {
        // Still added to `known`, so a file listing the same new company twice
        // does not import it twice.
        known.push({ id: 'pending', name: c.name, website: c.website });
        return true;
      }

      const match = findDuplicate(c, known);
      if (match) {
        skipped++;
        duplicates.push({ name: c.name, reason: match.reason, existing: match.existing.name });
        return false;
      }

      known.push({ id: 'pending', name: c.name, website: c.website });
      return true;
    });

    // A dry run answers "what would this do?" without doing it, which is what
    // the review step in the importer asks before anybody commits to a file.
    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        wouldCreate: fresh.length,
        skipped,
        duplicates: duplicates.slice(0, 50),
        errors,
      });
    }

    const places = fresh.map((c) => c.place);
    const ids = await insertChunked(
      supabase,
      'companies',
      fresh.map(({ place: _place, ...company }) => company),
    );
    if (typeof ids === 'string') return NextResponse.json({ error: ids }, { status: 400 });

    // One primary location per imported company that came with an address.
    // A failure here must not be silent: the companies are already in, and a
    // directory that imported 900 rows with no locations is a map with nothing
    // on it.
    const locations = ids
      .map((id, i) => ({ ...places[i], company_id: id, is_primary: true, created_by: profile.id }))
      .filter((l) => l.address || l.city || l.region);

    if (locations.length) {
      const placed = await insertChunked(supabase, 'company_locations', locations);
      if (typeof placed === 'string') {
        return NextResponse.json(
          { error: `Imported ${ids.length} companies, but their locations failed: ${placed}` },
          { status: 400 },
        );
      }
    }

    const created = ids.length;
    await logImport(supabase, 'companies', created);
    return NextResponse.json({ created, skipped, errors, duplicates: duplicates.slice(0, 50) });
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

  const inserted = await insertChunked(supabase, 'contacts', payload);
  if (typeof inserted === 'string') return NextResponse.json({ error: inserted }, { status: 400 });

  const created = inserted.length;
  await logImport(supabase, 'contacts', created);
  return NextResponse.json({ created, skipped, errors });
}
