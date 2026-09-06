/**
 * Weekly digest — an Edge Function, not deployed by default.
 *
 * Nobody opens a CRM they are not prompted to open. This mails officers a short
 * summary once a week: what moved, what is going cold, what is overdue.
 *
 * NOT WIRED UP YET, on purpose. It needs two things this repository must never
 * contain: a Resend API key and a service-role key. Both are set as Edge
 * Function secrets, which is the one place a service-role key is acceptable —
 * it stays inside the function, and the Next.js app still has no way to reach
 * it. See the bottom of this file for the four commands.
 *
 *   supabase secrets set RESEND_API_KEY=...
 *   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
 *   supabase functions deploy weekly-digest
 *   -- then schedule it: supabase/functions/weekly-digest/schedule.sql
 *
 * Why service-role here when the app refuses it everywhere else: this runs on a
 * timer with no signed-in user, so there is no session for RLS to read. The
 * function only ever reads, and only ever writes to a mailbox.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

type Row = Record<string, unknown>;

Deno.serve(async (request) => {
  // The cron job authenticates with the function's own secret, so a public URL
  // cannot be used to spam the club.
  const secret = Deno.env.get('DIGEST_SECRET');
  if (secret && request.headers.get('x-digest-secret') !== secret) {
    return new Response('Not authorised', { status: 401 });
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('DIGEST_FROM') ?? 'EZcrm <onboarding@resend.dev>';
  if (!resendKey) {
    return new Response('RESEND_API_KEY is not set', { status: 500 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: events }, { data: cold }, { data: overdue }, { data: officers }] =
    await Promise.all([
      supabase
        .from('audit_events')
        .select('summary, at, entity, action')
        .gte('at', weekAgo)
        .order('at', { ascending: false })
        .limit(200),
      supabase
        .from('companies')
        .select('name, status, last_touch_at')
        .is('archived_at', null)
        .in('status', ['contacted', 'in_conversation'])
        .or(`last_touch_at.is.null,last_touch_at.lt.${weekAgo}`)
        .limit(10),
      supabase
        .from('tasks')
        .select('title, due_date, companies(name)')
        .eq('done', false)
        .lt('due_date', today)
        .order('due_date')
        .limit(10),
      // Admins get the digest. Everyone else opted into a CRM, not a mailing list.
      supabase.from('profiles').select('email, full_name').eq('role', 'admin'),
    ]);

  const recipients = (officers ?? []).map((o: Row) => String(o.email));
  if (recipients.length === 0) {
    return new Response('Nobody to send to', { status: 200 });
  }

  const line = (s: string) => `<p style="margin:0 0 6px">${s}</p>`;
  const section = (title: string, items: string[]) =>
    items.length === 0
      ? ''
      : `<h3 style="margin:18px 0 6px;font-size:14px">${title}</h3>${items.map(line).join('')}`;

  const html = [
    `<div style="font:14px/1.5 system-ui,sans-serif;color:#16201d">`,
    `<h2 style="margin:0 0 4px;font-size:18px">This week in the CRM</h2>`,
    `<p style="margin:0;color:#6f7b78">${(events ?? []).length} things happened.</p>`,
    section(
      'Moved',
      (events ?? [])
        .filter((e: Row) => e.action === 'status_changed')
        .slice(0, 8)
        .map((e: Row) => String(e.summary)),
    ),
    section(
      'Going cold',
      (cold ?? []).map((c: Row) =>
        `${c.name} — nothing logged${c.last_touch_at ? '' : ' ever'}`,
      ),
    ),
    section(
      'Overdue',
      (overdue ?? []).map((t: Row) => {
        const company = (t.companies as { name?: string } | null)?.name;
        return `${t.title}${company ? ` · ${company}` : ''} — due ${t.due_date}`;
      }),
    ),
    `<p style="margin:18px 0 0;color:#6f7b78;font-size:12px">Sent once a week. Reply to nobody; this mailbox is not read.</p>`,
    `</div>`,
  ].join('');

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject: 'This week in the CRM',
      html,
    }),
  });

  if (!response.ok) {
    return new Response(`Resend refused: ${await response.text()}`, { status: 502 });
  }

  return new Response(`Sent to ${recipients.length}`, { status: 200 });
});
