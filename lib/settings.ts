import 'server-only';

import { serverClient } from '@/lib/supabase';
import { CLUB_DEFAULTS, type ClubDetails, type EmailTemplate } from '@/lib/cold-email';

/**
 * Club settings and email templates, read server-side.
 *
 * Both fall back to something usable when the table is empty or unreachable —
 * a fresh database, or a migration nobody has run yet. A composer that renders
 * with placeholders is a great deal better than a page that throws, and the
 * placeholders say plainly that something needs filling in.
 */
export async function loadClubDetails(): Promise<ClubDetails> {
  const supabase = await serverClient();
  const { data } = await supabase.from('settings').select('value').eq('key', 'club').maybeSingle();

  return { ...CLUB_DEFAULTS, ...((data?.value ?? {}) as Partial<ClubDetails>) };
}

export async function loadTemplates(): Promise<EmailTemplate[]> {
  const supabase = await serverClient();
  const { data } = await supabase
    .from('email_templates')
    .select('id, slug, name, guidance, subject, body, sort, suggest_for')
    .order('sort')
    .order('name');

  return (data ?? []) as EmailTemplate[];
}
