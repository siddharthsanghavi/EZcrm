import { NextResponse, type NextRequest } from 'next/server';
import { currentProfile, serverClient } from '@/lib/supabase';
import { contactName } from '@/lib/types';

export const dynamic = 'force-dynamic';

export type SearchHit = {
  kind: 'company' | 'contact';
  id: string;
  /** Where to go. A contact resolves to its company page. */
  href: string;
  label: string;
  detail: string | null;
};

/**
 * Companies and contacts, for the ⌘K palette.
 *
 * `ilike` rather than the GIN full-text indexes, deliberately. Somebody typing
 * into a palette is three letters into a name they half remember, and a
 * to_tsquery on "penn" matches nothing while `%penn%` finds Pennine Print
 * Works. The indexes still earn their keep for longer phrases elsewhere; here,
 * a prefix scan over a few thousand rows is instant and behaves the way people
 * expect a search box to behave.
 */
export async function GET(request: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });

  // % and _ are wildcards in LIKE; a member searching for "A_B" means those
  // characters, not "A, anything, B".
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  const supabase = await serverClient();

  const [{ data: companies }, { data: contacts }] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, city, industry, status, archived_at')
      .or(`name.ilike.${term},city.ilike.${term},industry.ilike.${term}`)
      .order('name')
      .limit(10),
    supabase
      .from('contacts')
      .select('id, first_name, last_name, title, email, company_id, companies(name)')
      .or(`first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`)
      .limit(10),
  ]);

  const hits: SearchHit[] = [
    ...(companies ?? []).map((c) => ({
      kind: 'company' as const,
      id: c.id as string,
      href: `/companies/${c.id}`,
      label: c.name as string,
      detail: [c.city, c.industry, c.archived_at ? 'archived' : null].filter(Boolean).join(' · ') || null,
    })),
    ...(contacts ?? []).map((c) => {
      const company = c.companies as unknown as { name: string } | null;
      return {
        kind: 'contact' as const,
        id: c.id as string,
        href: c.company_id ? `/companies/${c.company_id}` : '/contacts',
        label: contactName(c as never),
        detail: [c.title, company?.name].filter(Boolean).join(' · ') || null,
      };
    }),
  ];

  return NextResponse.json({ hits });
}
