import Link from 'next/link';
import type { Metadata } from 'next';
import { loadPublicClub } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'Privacy — EZcrm',
  description: 'What EZcrm stores, who can see it, and how Google sign-in data is used.',
  // Unlike the rest of the app, this page is meant to be found: Google's OAuth
  // reviewers fetch it, and a noindex would be actively unhelpful.
  robots: { index: true, follow: true },
};

// Was force-static. The club's name and contact address now come from the
// database, so this renders per request: prerendering would bake in whatever
// the settings said on the day of the deploy, and a stale contact address on a
// privacy policy is the one line here that has to be right.
export const dynamic = 'force-dynamic';

/**
 * Public privacy policy.
 *
 * Exists mainly because Google's OAuth consent screen wants one, but it is
 * written to be true rather than to be boilerplate — a reviewer checks that it
 * actually describes how Google user data is handled, and members deserve a
 * straight answer too. If the app's behaviour changes, change this.
 */
export default async function PrivacyPage() {
  const { club, school, contactEmail } = await loadPublicClub();

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <Link href="/login" className="text-sm text-black/50 hover:text-ink">
        ← EZcrm
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-1 text-sm text-black/55">
        EZcrm is a private outreach tracker used by one student club. Last updated{' '}
        {new Date('2026-08-24T00:00:00').toLocaleDateString()}.
      </p>

      <Section title="The short version">
        <p>
          EZcrm stores the names and contact details of <strong>companies</strong> the club
          approaches, and a record of who spoke to them and when. It is visible only to club
          members who have been added to an allowlist by an administrator. Nothing is sold, shared,
          or used for advertising, and there is no analytics or tracking of any kind.
        </p>
      </Section>

      <Section title="Signing in with Google">
        <p>
          If you sign in with Google, EZcrm receives only your <strong>email address</strong>,{' '}
          <strong>name</strong>, and <strong>profile picture URL</strong> — the standard{' '}
          <code className="text-[13px]">openid</code>, <code className="text-[13px]">email</code>{' '}
          and <code className="text-[13px]">profile</code> scopes. It requests nothing else: no
          access to Gmail, Drive, Calendar, Contacts, or any other Google service.
        </p>
        <p>
          Your email address is used for one purpose: to check whether you are on the club&apos;s
          allowlist and, if so, to identify which records you created. Your name is stored only so
          your teammates see a name rather than an email prefix. This data is never transferred to
          anyone, never used for advertising, and never used to train any model.
        </p>
        <p>
          Signing in with Google does not grant access on its own. If your address is not on the
          allowlist, no account is created for you and you see an empty page.
        </p>
      </Section>

      <Section title="What is stored">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>About you:</strong> your email address, your display name, and whether you are
            an administrator.
          </li>
          <li>
            <strong>Work you do:</strong> companies, contacts, notes, and tasks you create, each
            stamped with your name and the time.
          </li>
          <li>
            <strong>Sign-in records:</strong> when sign-ins succeed or fail, and when sign-in
            emails are requested, so an administrator can tell whether people are getting in.
            Retained for 90 days, then deleted automatically.
          </li>
        </ul>
        <p>
          Contact details for people at the companies we approach are business contact details —
          names, work emails, work phone numbers — entered by members from public or
          directly-provided sources.
        </p>
      </Section>

      <Section title="Who can see it">
        <p>
          Only club members on the allowlist. Access is enforced by the database itself
          (PostgreSQL row-level security), not by the app, so a mistake in a page cannot expose
          data the database would not have released. There is no public view of any record.
        </p>
      </Section>

      <Section title="Who else is involved">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Supabase</strong> — hosts the database and handles sign-in.
          </li>
          <li>
            <strong>Vercel</strong> — hosts the website.
          </li>
          <li>
            <strong>Google</strong> — only if you choose to sign in with Google.
          </li>
          <li>
            <strong>US Census Bureau geocoder</strong> — company street addresses are sent to it to
            place pins on a map. No personal data is ever sent.
          </li>
        </ul>
        <p>No other third party receives anything, and nothing is sold to anyone.</p>
      </Section>

      <Section title="Removing your data">
        <p>
          Ask an administrator to remove you and your access ends immediately. To have the records
          you created deleted or reassigned, or to ask what is held about you, contact the club
          directly. If you are at a company we have contacted and want your details removed, say so
          and we will delete them.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          This app is run by {club}
          {school ? ` at ${school}` : ''}.{' '}
          {contactEmail ? (
            <>
              Reach the administrator at{' '}
              <a href={`mailto:${contactEmail}`} className="underline">
                {contactEmail}
              </a>
              .
            </>
          ) : (
            <>Reach the administrator through whoever gave you access to this app.</>
          )}
        </p>
      </Section>

      <p className="mt-10 border-t border-black/10 pt-4 text-xs text-black/40">
        <Link href="/terms" className="underline">
          Terms of use
        </Link>
        {' · '}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-black/70">{children}</div>
    </section>
  );
}
