'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { browserClient } from '@/lib/supabase-browser';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

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
      .then(({ error }) => {
        if (error) {
          setState('error');
          setMessage(error.message);
          return;
        }
        history.replaceState(null, '', window.location.pathname);
        router.replace(params.get('next') ?? '/');
        router.refresh();
      });
  }, [router, params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setMessage('');

    const next = params.get('next');
    const redirect = new URL('/auth/callback', window.location.origin);
    if (next) redirect.searchParams.set('next', next);

    const { error } = await browserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect.toString() },
    });

    if (error) {
      setState('error');
      setMessage(error.message);
    } else {
      setState('sent');
    }
  }

  return (
    <div className="card w-full max-w-sm p-8">
      <h1 className="text-xl font-semibold">EZcrm</h1>
      <p className="mt-1 text-sm text-black/55">Club outreach tracker</p>

      {state === 'sent' ? (
        <div className="mt-6 space-y-3">
          <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
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
            <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{message}</p>
          )}

          <p className="pt-2 text-xs text-black/45">
            No passwords. We email you a one-time link, so there is nothing to leak or reuse.
          </p>
        </form>
      )}
    </div>
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
