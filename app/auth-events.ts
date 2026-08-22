'use server';

import { recordLogin, recordSignIn } from '@/lib/login-log';

/**
 * The implicit flow finishes in the browser — Supabase returns the tokens in
 * the URL fragment, which never reaches the server, so /auth/callback cannot
 * see it and /login completes the sign-in itself. This is how that path gets
 * counted alongside the two server routes.
 *
 * By the time this is called the session cookie is set, so `recordSignIn`
 * resolves the user the same way it does everywhere else.
 */
export async function logImplicitSignIn(): Promise<void> {
  await recordSignIn('implicit');
}

export async function logImplicitFailure(reason: string): Promise<void> {
  await recordLogin('failed', 'implicit', { reason });
}
