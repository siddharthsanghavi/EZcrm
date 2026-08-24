'use server';

import { currentProfile, serverClient } from '@/lib/supabase';

export type GeocodeResult = {
  processed: number;
  updated: number;
  unmatched: number;
  remaining: number;
  done: boolean;
  suspect?: { id: string; km: number }[];
  error?: string;
};

/**
 * Runs one batch of street-level geocoding.
 *
 * The work happens in the `geocode` Edge Function, not here, for two reasons:
 * the Census endpoint needs a TLS stack Postgres's `http` extension can't
 * manage, and the writes need a service-role key that must never enter this
 * app. This action only forwards the caller's own access token, so the function
 * can decide for itself whether they're an admin — the check below is a fast
 * fail for a better error message, not the security boundary.
 */
export async function runGeocodeBatch(limit = 150): Promise<GeocodeResult> {
  const profile = await currentProfile();
  if (profile?.role !== 'admin') {
    return { processed: 0, updated: 0, unmatched: 0, remaining: 0, done: false, error: 'Admins only.' };
  }

  const supabase = await serverClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { processed: 0, updated: 0, unmatched: 0, remaining: 0, done: false, error: 'Not signed in.' };
  }

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/geocode`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ limit }),
        cache: 'no-store',
      },
    );

    const body = await res.json();
    if (!res.ok) {
      return {
        processed: 0, updated: 0, unmatched: 0, remaining: 0, done: false,
        error: body?.error ?? `Geocoder returned ${res.status}.`,
      };
    }
    return body as GeocodeResult;
  } catch {
    return {
      processed: 0, updated: 0, unmatched: 0, remaining: 0, done: false,
      error: 'Could not reach the geocoder. Try again in a minute.',
    };
  }
}

/** How many companies still have a street address but only a town-centre pin. */
export async function geocodePending(): Promise<number> {
  const supabase = await serverClient();
  const { count } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .not('address', 'is', null)
    .not('address', 'ilike', '%verify%')
    .neq('geo_precision', 'address');
  return count ?? 0;
}
