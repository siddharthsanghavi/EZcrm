import { NextResponse, type NextRequest } from 'next/server';
import { currentProfile, serverClient } from '@/lib/supabase';
import {
  CLUB_DEFAULTS,
  contactName,
  draftEmail,
  draftsToCsv,
  suggestedTemplate,
  type ClubDetails,
  type TemplateId,
} from '@/lib/cold-email';
import { TEMPLATES } from '@/lib/cold-email';

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

  const raw = params.get('template');
  const template = (TEMPLATES.some((t) => t.id === raw) ? raw : null) as TemplateId | null;

  // Club details live in the member's browser, so they arrive as query
  // parameters. Anything missing falls back to the visible placeholder.
  const club: ClubDetails = {
    clubName: params.get('clubName') || CLUB_DEFAULTS.clubName,
    school: params.get('school') || CLUB_DEFAULTS.school,
    groupSize: params.get('groupSize') || CLUB_DEFAULTS.groupSize,
    visitLength: params.get('visitLength') || CLUB_DEFAULTS.visitLength,
  };

  const supabase = await serverClient();

  const [{ data: companies, error }, { data: contacts }] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, type, city, industry, interest, tier, status')
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

  const rows = (companies ?? []).map((company) => {
    const theirs = (contacts ?? []).filter((c) => c.company_id === company.id);
    const contact = theirs.find((c) => c.email) ?? theirs[0] ?? null;

    const draft = draftEmail(template ?? suggestedTemplate(company as never), {
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
