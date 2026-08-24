import { NextResponse, type NextRequest } from 'next/server';
import { serverClient } from '@/lib/supabase';
import { recordLogin, recordSignIn } from '@/lib/login-log';

/** Send the user back to /login with something they can act on. */
function fail(origin: string, reason: string) {
  const url = new URL('/login', origin);
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  // Supabase reports its own failures (expired link, redirect URL not on the
  // allowlist) as query params rather than an HTTP error. Surface them instead
  // of treating this like a missing code.
  // OAuth and magic links both come back as ?code=, so the login tracker can't
  // tell them apart without this marker. Mixing them would make the failure
  // breakdown on /members meaningless.
  const via = searchParams.get('via') === 'google' ? 'oauth' : 'pkce';

  const supabaseError = searchParams.get('error_description') ?? searchParams.get('error');
  if (supabaseError) {
    await recordLogin('failed', via, { reason: supabaseError });
    return fail(origin, supabaseError);
  }

  const code = searchParams.get('code');
  if (!code) {
    // The token was delivered in the URL fragment (implicit flow) rather than as
    // a code. A fragment never reaches the server, so this has to be finished in
    // the browser — /login reads it and completes sign-in there.
    await recordLogin('failed', 'implicit', { reason: 'token arrived in URL fragment' });
    return fail(origin, 'no-code');
  }

  const supabase = await serverClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Most often the PKCE verifier cookie is absent because the link was opened
    // in a different browser or device than the one that requested it.
    await recordLogin('failed', via, { reason: error.message });
    return fail(origin, error.message);
  }

  await recordSignIn(via);

  // Only redirect within this app, so a crafted link can't bounce a
  // freshly authenticated user to someone else's site.
  const next = searchParams.get('next') ?? '/';
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return NextResponse.redirect(new URL(target, origin));
}
