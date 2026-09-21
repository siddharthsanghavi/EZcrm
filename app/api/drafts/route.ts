import { NextResponse, type NextRequest } from 'next/server';
import { currentProfile, serverClient } from '@/lib/supabase';
import { contactName, draftEmail, draftsToCsv, suggestTemplate } from '@/lib/cold-email';
import { loadClubDetails, loadTemplates } from '@/lib/settings';
import { primaryLocation } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX = 200;

/**
 * A cold-email draft for every company you ticked, as a CSV.
 *
 * The per-company composer is for the one you are about to write; this is for
 * the forty you triaged on Sunday. Columns are what a mail-merge tool expects,
 * so the file goes straight into one — this app still sends nothing.
 *
 * The recipient is the company's first contact with an email address. Where
 * there is none the row still appears, with an empty address and a salutation
 * of "Hello," so the gap is visible in the spreadsheet rather than silently
 * dropped.
 */
export async function GET(request: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, MAX);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No companies selected.' }, { status: 400 });
  }

  // Templates and club details are shared settings now, so both are read here
  // rather than passed in from whichever browser started the download.
  const [templates, club] = await Promise.all([loadTemplates(), loadClubDetails()]);
  if (templates.length === 0) {
    return NextResponse.json({ error: 'No email templates configured.' }, { status: 400 });
  }

  const wanted = params.get('template');
  const chosen = templates.find((t) => t.slug === wanted || t.id === wanted) ?? null;

  const supabase = await serverClient();

  const [{ data: companies, error }, { data: contacts }] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, type, industry, interest, tier, status, company_locations(city, region, is_primary)')
      .in('id', ids)
      .order('name'),
    supabase
      .from('contacts')
      .select('id, company_id, first_name, last_name, title, email')
      .in('company_id', ids)
      .order('created_at'),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const sender = { name: profile.full_name?.trim() || profile.email.split('@')[0], email: profile.email };

  const rows = (companies ?? []).map((row) => {
    // The letter says "your Rome site"; the primary location is the one that
    // means, since 015 moved city off the company itself.
    const place = primaryLocation(
      row.company_locations as { city: string | null; region: string | null; is_primary: boolean }[] | null,
    );
    const company = { ...row, city: place?.city ?? null };
    const theirs = (contacts ?? []).filter((c) => c.company_id === company.id);
    const contact = theirs.find((c) => c.email) ?? theirs[0] ?? null;

    // Per company, so a batch of mixed statuses gets the right letter for each:
    // the prospect is asked, the one already contacted is nudged.
    const template = chosen ?? suggestTemplate(templates, company as never) ?? templates[0];

    const draft = draftEmail(template, {
      company: company as never,
      contact: contact as never,
      sender,
      club,
    });

    return {
      company: company.name as string,
      to: (contact?.email as string | null) ?? null,
      name: contact ? contactName(contact as never) : null,
      draft,
    };
  });

  const { error: logError } = await supabase.rpc('log_data_transfer', {
    p_action: 'exported',
    p_table: 'companies',
    p_rows: rows.length,
  });
  if (logError) console.error('Could not log draft export:', logError.message);

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(draftsToCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cold-emails-${stamp}.csv"`,
    },
  });
}
