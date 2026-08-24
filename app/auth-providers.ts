'use server';

/**
 * Is Google sign-in actually switched on for this project?
 *
 * This has to be asked BEFORE offering the button. `signInWithOAuth` does not
 * return an error when a provider is disabled — it navigates the browser
 * straight to Supabase, which answers with a raw JSON 400
 * ("Unsupported provider: provider is not enabled") on the supabase.co domain.
 * The visitor is then stranded on a blob of JSON with no way back, and no
 * client-side error handler ever runs.
 *
 * Probing from the server sidesteps CORS, and means the button appears by
 * itself the moment the provider is enabled in the dashboard — no redeploy, and
 * no window where the app offers a door that opens onto an error page.
 */
export async function isGoogleEnabled(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;

  try {
    const res = await fetch(`${url}/auth/v1/authorize?provider=google`, {
      method: 'GET',
      headers: { apikey: key },
      // Don't follow it to Google — the status alone is the answer.
      redirect: 'manual',
      // Re-checked every few minutes, so enabling the provider shows up
      // without a deploy, without probing on every page view.
      next: { revalidate: 300 },
    });

    // Enabled -> a redirect toward Google. Disabled -> 400 with a JSON body.
    return res.status >= 300 && res.status < 400;
  } catch {
    // If the probe itself fails, hide the button rather than offer a broken one.
    return false;
  }
}
