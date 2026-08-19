import 'server-only';

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

/** Current user's profile, or null if they aren't a club member. */
export async function currentProfile() {
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
}
