import { createBrowserClient } from '@supabase/ssr';

/**
 * Client-component Supabase client.
 *
 * Kept in its own module so Client Components never transitively import
 * `next/headers` — doing so is a build error, not just dead weight.
 *
 * The anon key is safe to ship to the browser: it grants no access on its own.
 * Row-level security in Postgres decides what each signed-in user can see.
 */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
