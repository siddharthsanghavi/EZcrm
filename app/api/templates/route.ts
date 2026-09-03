import { NextResponse } from 'next/server';
import { currentProfile } from '@/lib/supabase';
import { templatesToMarkdown } from '@/lib/cold-email';
import { loadTemplates } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * Every template as one Markdown file.
 *
 * A download rather than a copy button: this is the artefact you keep — commit
 * it, mail it to next year's committee, diff it against what the club sent last
 * season. Viewers may take a copy; changing them is what needs write access.
 */
export async function GET() {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });

  const templates = await loadTemplates();
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(templatesToMarkdown(templates), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="email-templates-${stamp}.md"`,
    },
  });
}
