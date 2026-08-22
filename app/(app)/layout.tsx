import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentProfile } from '@/lib/supabase';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/companies', label: 'Companies' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/map', label: 'Map' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/import', label: 'Import / Export' },
  { href: '/members', label: 'Members' },
  { href: '/guide', label: 'Guide' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Signed in but not on the allowlist means no profile row, and RLS would show
  // them an empty app. Say so plainly instead.
  const profile = await currentProfile();
  if (!profile) redirect('/no-access');

  return (
    <div className="min-h-screen">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            EZcrm
          </Link>

          <nav className="flex flex-1 items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm text-black/65 hover:bg-black/[0.04] hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-black/45 sm:block">{profile.email}</span>
            <form action="/auth/signout" method="post">
              <button className="text-xs text-black/45 hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
