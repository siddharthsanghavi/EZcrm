import 'server-only';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { serverClient } from '@/lib/supabase';

export type LoginEvent = 'signed_in' | 'denied' | 'failed' | 'signed_out';
export type LoginMethod = 'pkce' | 'token_hash' | 'implicit' | 'unknown';

/**
 * Records how a sign-in went.
 *
 * EVERY call is swallowed on failure, deliberately. This is a tracker bolted
 * onto the auth path, and a tracker that can lock the club out of its own CRM
 * is worse than no tracker. If the insert fails, sign-in continues and we lose
 * one row.
 *
 * Same IP policy as the email quota: hashed with a configured salt or not
 * recorded at all, because an unsalted hash of an IPv4 address is reversible by
 * brute force.
 */
export async function recordLogin(
  event: LoginEvent,
  method: LoginMethod = 'unknown',
  opts: { email?: string | null; reason?: string | null } = {},
): Promise<void> {
  try {
    let ipHash: string | null = null;
    const salt = process.env.AUTH_RATE_SALT;

    if (salt) {
      const h = await headers();
      const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip');
      if (ip) ipHash = createHash('sha256').update(`${ip}${salt}`).digest('hex');
    }

    const supabase = await serverClient();
    await supabase.rpc('record_login_event', {
      p_event: event,
      p_method: method,
      p_email: opts.email ?? null,
      p_reason: opts.reason ?? null,
      p_ip_hash: ipHash,
    });
  } catch {
    // Intentionally silent. See above.
  }
}

/**
 * Called right after a session is established. Distinguishes a member from
 * someone who authenticated but isn't on the allowlist — the second is the
 * allowlist working, and it is worth being able to see it happen.
 */
export async function recordSignIn(method: LoginMethod): Promise<void> {
  try {
    const supabase = await serverClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    await recordLogin(profile ? 'signed_in' : 'denied', method, { email: user.email });
  } catch {
    // As above.
  }
}
