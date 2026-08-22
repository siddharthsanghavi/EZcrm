'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { serverClient } from '@/lib/supabase';

/**
 * Sign-in email quota.
 *
 * These are the only server actions in the app that run WITHOUT a session —
 * they back the login page, so `requireMember` would defeat the purpose. That
 * makes them the app's one unauthenticated write path, which is why the
 * database side is written the way it is: the underlying table is unreadable by
 * anon, these functions return counts and never addresses, and a claim only
 * counts against the quota for a minute unless it is confirmed.
 *
 * See supabase/migrations/009_auth_email_quota.sql for the reasoning.
 */

export type Quota = {
  used: number;
  quota: number;
  retryAfter: string | null;
};

export type Claim = Quota & {
  allowed: boolean;
  claimId: string | null;
};

/**
 * Per-IP capping is opt-in: without a salt, a SHA-256 of an IP address is
 * trivially reversible by running through the whole v4 space, so storing one
 * would be storing the address in a thin disguise. No salt configured means no
 * IP recorded and no per-IP cap — the club-wide limit still applies.
 */
async function ipHash(): Promise<string | null> {
  const salt = process.env.AUTH_RATE_SALT;
  if (!salt) return null;

  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || h.get('x-real-ip');
  if (!ip) return null;

  return createHash('sha256').update(`${ip}${salt}`).digest('hex');
}

/** How much of the club's hourly allowance is gone. Aggregate only. */
export async function signInQuota(): Promise<Quota | null> {
  const supabase = await serverClient();
  const { data, error } = await supabase.rpc('auth_email_quota').single();

  if (error || !data) return null;

  const row = data as { used: number; quota: number; retry_after: string | null };
  return { used: row.used, quota: row.quota, retryAfter: row.retry_after };
}

/**
 * Reserve one of the hour's emails. Returns `allowed: false` rather than
 * throwing, so the login page can show the wait time instead of an error.
 */
export async function claimSignInEmail(email: string): Promise<Claim | null> {
  const supabase = await serverClient();

  const { data, error } = await supabase
    .rpc('claim_auth_email', { p_email: email.trim().toLowerCase(), p_ip_hash: await ipHash() })
    .single();

  if (error || !data) return null;

  const row = data as {
    allowed: boolean;
    claim_id: string | null;
    used: number;
    quota: number;
    retry_after: string | null;
  };

  return {
    allowed: row.allowed,
    claimId: row.claim_id,
    used: row.used,
    quota: row.quota,
    retryAfter: row.retry_after,
  };
}

/**
 * Settle a claim once Supabase has answered. Releasing a failed send matters:
 * with an allowance this small, charging the club for a typo would be its own
 * small outage.
 */
export async function settleSignInEmail(claimId: string, sent: boolean): Promise<void> {
  const supabase = await serverClient();
  await supabase.rpc('settle_auth_email', { p_claim_id: claimId, p_sent: sent });
}
