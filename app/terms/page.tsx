import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of use — EZcrm',
  description: 'Terms for club members using EZcrm.',
  robots: { index: true, follow: true },
};

export const dynamic = 'force-static';

/** Public terms. Short on purpose — this is an internal club tool, not a product. */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <Link href="/login" className="text-sm text-black/50 hover:text-ink">
        ← EZcrm
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Terms of use</h1>
      <p className="mt-1 text-sm text-black/55">
        Last updated {new Date('2026-08-24T00:00:00').toLocaleDateString()}.
      </p>

      <Section title="What this is">
        <p>
          EZcrm is a private tool for one student club at Kennesaw State University, used to track
          outreach to companies for plant tours and sponsorship. It is not a commercial product,
          nothing is charged for it, and it is not offered to the general public.
        </p>
      </Section>

      <Section title="Who may use it">
        <p>
          Only people an administrator has added to the club&apos;s allowlist. Access is granted and
          removed at the administrators&apos; discretion, typically when someone joins or leaves the
          club. Do not share your sign-in link or let anyone else use your account.
        </p>
      </Section>

      <Section title="Using it responsibly">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            Everything in here is visible to every member. There are no private records — assume a
            teammate will read what you write.
          </li>
          <li>
            The companies and people listed are real. Treat their contact details as you would want
            yours treated: use them for club outreach, and nothing else.
          </li>
          <li>
            Do not export the data for personal use, and do not pass it to anyone outside the club.
          </li>
          <li>Keep what you log accurate. A wrong note is worse than no note.</li>
        </ul>
      </Section>

      <Section title="No warranty">
        <p>
          This is a volunteer-built tool provided as-is, with no guarantee of availability or of
          the accuracy of anything stored in it. It runs on free hosting tiers and may be
          unavailable at times. Keep your own copy of anything you cannot afford to lose — every
          member can export a CSV at any time from the Import / Export page.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          These terms may change as the club&apos;s needs do. Material changes will be noted in the
          in-app guide, which records every change to the app.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions go to{' '}
          <a href="mailto:siddharth.sanghavi.360@gmail.com" className="underline">
            siddharth.sanghavi.360@gmail.com
          </a>
          .
        </p>
      </Section>

      <p className="mt-10 border-t border-black/10 pt-4 text-xs text-black/40">
        <Link href="/privacy" className="underline">
          Privacy
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
