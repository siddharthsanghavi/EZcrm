'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { browserClient } from '@/lib/supabase-browser';
import { claimSignInEmail, settleSignInEmail, signInQuota, type Quota } from '@/app/auth-quota';
import { logImplicitFailure, logImplicitSignIn } from '@/app/auth-events';
import { isGoogleEnabled } from '@/app/auth-providers';

/** "in 23 minutes" / "shortly" — a wait a person can act on. */
function waitLabel(retryAfter: string | null): string {
  if (!retryAfter) return 'shortly';
  const mins = Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 60000);
  if (mins <= 1) return 'in about a minute';
  return `in ${mins} minute${mins === 1 ? '' : 's'}`;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [quota, setQuota] = useState<Quota | null>(null);
  // Null while unknown, so the button never flashes in and out.
  const [googleReady, setGoogleReady] = useState<boolean | null>(null);

  // Show whatever the callback couldn't finish — in words a club member can act
  // on. Supabase's own messages are written for developers ("PKCE code verifier
  // not found in storage…"), which is alarming and unactionable for everyone else.
  useEffect(() => {
    const err = params.get('error');
    if (!err) return;

    const friendly = (raw: string) => {
      const t = raw.toLowerCase();
      if (t.includes('code verifier') || t.includes('pkce')) {
        return 'This link was opened in a different browser than the one that asked for it — mail apps often open links in their own browser. Request a new link below, then copy it into this browser, or open your email here.';
      }
      if (t.includes('expired') || t.includes('invalid')) {
        return 'That link has expired or was already used. Sign-in links work once and last an hour — request a fresh one below.';
      }
      if (raw === 'no-code' || raw === 'no-token') {
        return 'That sign-in link was incomplete. Request a fresh one below.';
      }
      return raw;
    };

    setState('error');
    setMessage(friendly(err));
  }, [params]);

  // If Supabase used the implicit flow, the tokens arrive in the URL fragment,
  // which is never sent to the server — so the callback route cannot see them.
  // Finish the sign-in here instead of stranding the user on an error.
  useEffect(() => {
    if (!window.location.hash.includes('access_token')) return;

    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get('access_token');
    const refresh_token = hash.get('refresh_token');
    if (!access_token || !refresh_token) return;

    setState('sending');
    browserClient()
      .auth.setSession({ access_token, refresh_token })
      .then(async ({ error }) => {
        if (error) {
          setState('error');
          setMessage(error.message);
          await logImplicitFailure(error.message);
          return;
        }
        // Awaited before navigating: the cookie is set by now, so the server
        // action can resolve who signed in, and leaving the page mid-call
        // would lose the row.
        await logImplicitSignIn();
        history.replaceState(null, '', window.location.pathname);
        router.replace(params.get('next') ?? '/');
        router.refresh();
      });
  }, [router, params]);

  // Show what's left of the club's hourly allowance before anyone spends one.
  useEffect(() => {
    signInQuota().then(setQuota);
  }, []);

  // Only offer Google once the provider really answers — see auth-providers.ts.
  useEffect(() => {
    isGoogleEnabled().then(setGoogleReady);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setMessage('');

    // Ask for one of the hour's emails first. If the club is out, stop here —
    // sending the request anyway would spend the quota at Supabase and come
    // back as a 429 we could not explain.
    const claim = await claimSignInEmail(email);

    if (claim) {
      setQuota({ used: claim.used, quota: claim.quota, retryAfter: claim.retryAfter });

      if (!claim.allowed) {
        setState('error');
        setMessage(
          `The club has used all ${claim.quota} sign-in emails for this hour — they're shared ` +
            `between everyone, not per person. Try again ${waitLabel(claim.retryAfter)}. ` +
            `If you already have a link in your inbox, it is still good for an hour.`,
        );
        return;
      }
    }
    // A null claim means the quota service itself is unreachable. Fall through
    // and let Supabase decide rather than blocking sign-in on our own tracker.

    const next = params.get('next');
    const redirect = new URL('/auth/callback', window.location.origin);
    if (next) redirect.searchParams.set('next', next);

    const { error } = await browserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect.toString() },
    });

    // Release the claim if nothing was actually sent, so a typo doesn't cost
    // the club one of its two.
    if (claim?.claimId) await settleSignInEmail(claim.claimId, !error);

    if (error) {
      setState('error');
      setMessage(error.message);
      setQuota(await signInQuota());
    } else {
      setState('sent');
    }
  }

  /**
   * Google sign-in. Sends no email, so it is not subject to the club's shared
   * hourly allowance, and it has no link to open in the wrong browser — the two
   * things that actually stop people getting in.
   *
   * Access is still governed by the allowlist: signing in with Google creates
   * an auth user, but `handle_new_user` only mints a profile for an address in
   * `allowed_emails`. A stranger who signs in lands on /no-access exactly as
   * before, so this widens the front door without widening access.
   */
  async function google() {
    setState('sending');
    setMessage('');

    const next = params.get('next');
    const redirect = new URL('/auth/callback', window.location.origin);
    redirect.searchParams.set('via', 'google');
    if (next) redirect.searchParams.set('next', next);

    const { error } = await browserClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirect.toString() },
    });

    // On success the browser is already navigating to Google; only a failure
    // returns here.
    if (error) {
      setState('error');
      setMessage(
        error.message.toLowerCase().includes('provider')
          ? 'Google sign-in isn’t switched on for this project yet. Use the email link below.'
          : error.message,
      );
    }
  }

  return (
    <div className="card w-full max-w-sm p-8">
      <h1 className="text-xl font-semibold">EZcrm</h1>
      <p className="mt-1 text-sm text-black/55">Club outreach tracker</p>

      {state !== 'sent' && googleReady && (
        <div className="mt-6">
          <button
            type="button"
            onClick={google}
            disabled={state === 'sending'}
            className="btn-ghost w-full gap-2.5"
          >
            <GoogleMark />
            Continue with Google
          </button>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-black/10" />
            <span className="text-[11px] uppercase tracking-wide text-black/35">or</span>
            <span className="h-px flex-1 bg-black/10" />
          </div>
        </div>
      )}

      {state === 'sent' ? (
        <div className="mt-6 space-y-3">
          <p className="rounded-md bg-success/10 p-3 text-sm text-success">
            Check <strong>{email}</strong> for a sign-in link. It expires in an hour.
          </p>
          <p className="text-xs text-black/45">
            Open it in <strong>this same browser</strong> — the link is tied to this device, so
            forwarding it or opening it on your phone won&apos;t work.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@club.org"
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={state === 'sending'}>
            {state === 'sending' ? 'Working…' : 'Email me a sign-in link'}
          </button>

          {state === 'error' && (
            <p className="rounded-md bg-danger/10 p-3 text-sm text-danger">{message}</p>
          )}

          {/* Only worth saying once some of the allowance is gone — on a quiet
              hour this is noise, and "2 of 2 remaining" invites people to spend
              them. */}
          {quota && quota.used > 0 && state !== 'error' && (
            <p className="flex items-center gap-2 text-xs text-black/45">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  quota.used >= quota.quota ? 'bg-danger' : 'bg-warn'
                }`}
              />
              {quota.used >= quota.quota ? (
                <>
                  The club&apos;s {quota.quota} sign-in emails for this hour are used. Next one free{' '}
                  {waitLabel(quota.retryAfter)}.
                </>
              ) : (
                <>
                  {quota.used} of {quota.quota} sign-in emails used this hour, shared by the whole
                  club.
                </>
              )}
            </p>
          )}

          <p className="pt-2 text-xs text-black/45">
            No passwords. We email you a one-time link, so there is nothing to leak or reuse.
          </p>
        </form>
      )}
    </div>
  );
}

/**
 * Google's own four-colour mark, at its fixed colours.
 *
 * Deliberately NOT themed: Google's branding guidelines require the mark to
 * keep its own colours, so this is one of the few places in the app that must
 * not follow the palette. (`text-white` here would resolve to the dark surface
 * in dark mode anyway — see tailwind.config.ts.)
 */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Suspense fallback={<div className="card w-full max-w-sm p-8 text-sm">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
