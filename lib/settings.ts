import 'server-only';

import { serverClient } from '@/lib/supabase';
import { CLUB_DEFAULTS, type ClubDetails, type EmailTemplate } from '@/lib/cold-email';
import { ROTTING_DEFAULTS, STATUSES, type RottingRules, type Status } from '@/lib/types';

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

/**
 * The club's public identity, for /privacy and /terms.
 *
 * Those pages are reachable without a session — Google's OAuth reviewer fetches
 * them — so the `settings` row they read is the one key exposed to anon by a
 * policy of its own. That is also why nothing private may live in it.
 *
 * Every field falls back to something a stranger can still act on, because
 * these pages have to say something true before anyone has filled the settings
 * in, and a privacy policy naming "[YOUR CLUB]" is worse than one naming none.
 */
export async function loadPublicClub(): Promise<{
  club: string;
  school: string | null;
  contactEmail: string | null;
}> {
  const supabase = await serverClient();
  const { data } = await supabase.from('settings').select('value').eq('key', 'club').maybeSingle();

  const value = (data?.value ?? {}) as Record<string, string>;
  const real = (v?: string) => (v && !v.startsWith('[') ? v.trim() : '');

  return {
    club: real(value.clubName) || 'a student club',
    school: real(value.school) || null,
    contactEmail: real(value.contactEmail) || null,
  };
}

/**
 * How long each stage may sit untouched before a company counts as cold.
 *
 * Falls back to the defaults rather than to "never": a club that has not
 * configured this still wants a going-cold list, and one that quietly stopped
 * flagging anything would look like an app with nothing to do.
 */
export async function loadRottingRules(): Promise<RottingRules> {
  const supabase = await serverClient();
  const { data } = await supabase.from('settings').select('value').eq('key', 'rotting').maybeSingle();

  const stored = (data?.value ?? null) as Record<string, unknown> | null;
  if (!stored) return ROTTING_DEFAULTS;

  const rules: RottingRules = {};
  for (const status of STATUSES) {
    const n = Number.parseInt(String(stored[status] ?? ''), 10);
    if (Number.isFinite(n) && n > 0) rules[status as Status] = n;
  }
  return rules;
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
