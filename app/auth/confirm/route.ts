import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase';

/**
 * Token-hash sign-in. Supabase's recommended flow for server-rendered apps.
 *
 * Unlike /auth/callback, this needs no PKCE verifier cookie, so the link works
 * when opened in a different browser or device than the one that requested it —
 * which is the normal case, because mail apps open links in their own in-app
 * browser with its own cookie jar.
 *
 * Requires the Supabase email template to point here:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const fail = (reason: string) => {
    const url = new URL('/login', origin);
    url.searchParams.set('error', reason);
    return NextResponse.redirect(url);
  };

  const supabaseError = searchParams.get('error_description') ?? searchParams.get('error');
  if (supabaseError) return fail(supabaseError);

  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  if (!token_hash || !type) return fail('no-token');

  const supabase = await serverClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error) return fail(error.message);

  const next = searchParams.get('next') ?? '/';
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return NextResponse.redirect(new URL(target, origin));
}
