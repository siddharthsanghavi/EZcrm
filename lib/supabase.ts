import 'server-only';

import { cache } from 'react';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client. This module imports `next/headers`, so it must
 * never be pulled into a Client Component — use `lib/supabase-browser.ts` there.
 * The `server-only` import turns a mistake into a clear build error.
 *
 * Only the anon key is ever used. There is no service-role key in this app, so
 * nothing here can bypass row-level security.
 */
export async function serverClient() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only. The
            // middleware refreshes the session instead, so this is safe to skip.
          }
        },
      },
    },
  );
}

/**
 * Every row, not the first thousand.
 *
 * PostgREST caps a response at 1,000 rows (`db-max-rows`) whatever `.limit()`
 * says, and says nothing when it does: `.limit(5000)` on 1,268 companies returns
 * 1,000 with no error. The pipeline board rendered 994 prospects while the
 * database held 1,260, and every total under it was wrong by the same amount.
 *
 * Pass a function that builds the query with a range applied; this walks the
 * ranges until a page comes back short. Use it only where every row is truly
 * needed — a board that draws all of them — and count with `head: true`
 * everywhere else, because this is N requests, not one.
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: all, error };
    if (!data || data.length === 0) return { data: all, error: null };
    all.push(...data);
    // Advance by what actually came back, and stop only on an empty page. A
    // "short page means last page" shortcut would break the moment the server
    // cap was set below pageSize — which is precisely the bug this fixes.
    from += data.length;
  }
}

/**
 * Current user's profile, or null if they aren't a club member.
 *
 * Memoised per request with React `cache()`. The layout and the page both ask
 * who is signed in, and without this each made its own `auth.getUser()` round
 * trip to Supabase Auth followed by its own `profiles` lookup — two of the
 * dashboard's ~8 back-to-back network trips were this, done twice. `cache()`
 * is scoped to one server render, so nothing leaks between users or requests.
 */
export const currentProfile = cache(async function currentProfile() {
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', user.id)
    .maybeSingle();

  return data;
});
