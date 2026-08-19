'use client';

import { useState } from 'react';
import { browserClient } from '@/lib/supabase-browser';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');

    const { error } = await browserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setState('error');
      setMessage(error.message);
    } else {
      setState('sent');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold">EZcrm</h1>
        <p className="mt-1 text-sm text-black/55">Club outreach tracker</p>

        {state === 'sent' ? (
          <p className="mt-6 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
            Check <strong>{email}</strong> for a sign-in link. It expires in an hour.
          </p>
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
              {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
            </button>

            {state === 'error' && <p className="text-sm text-rose-700">{message}</p>}

            <p className="pt-2 text-xs text-black/45">
              No passwords. We email you a one-time link, so there is nothing to leak or reuse.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
