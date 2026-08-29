'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { displayName, type Profile } from '@/lib/types';

export type RailCounts = {
  companies: number | null;
  contacts: number | null;
  tasks: number | null;
  members: number | null;
  deletions: number | null;
};

const NAV = [
  { href: '/', label: 'Dashboard', key: null },
  { href: '/companies', label: 'Companies', key: 'companies' },
  { href: '/pipeline', label: 'Pipeline', key: null },
  { href: '/map', label: 'Map', key: null },
  { href: '/contacts', label: 'Contacts', key: 'contacts' },
  { href: '/tasks', label: 'Tasks', key: 'tasks' },
  { href: '/activity', label: 'Activity', key: null },
  { href: '/import', label: 'Import / Export', key: null },
  { href: '/members', label: 'Members', key: 'members' },
  // Sits by Members because it is the other "who is allowed to do what" page.
  // The count is pending requests only — a badge for a log nobody has to act on
  // would be a permanent, meaningless number.
  { href: '/deletions', label: 'Deletions', key: 'deletions' },
  { href: '/guide', label: 'Guide', key: null },
] as const;

/**
 * Navigation rail.
 *
 * A rail rather than a top bar so the nav stops competing with each page's own
 * heading, and so every destination can carry its count — "Tasks 12" is a
 * reason to click that "Tasks" alone never gave anyone.
 *
 * Below `lg` it collapses to a scrolling top strip: members log tours from the
 * plant floor on a phone, where 216px of permanent furniture is most of the
 * screen.
 */
export function NavRail({
  profile,
  counts,
}: {
  profile: Pick<Profile, 'full_name' | 'email' | 'role'>;
  counts: RailCounts;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  const items = NAV.map((item) => ({
    ...item,
    count: item.key ? counts[item.key] : null,
    active: isActive(item.href),
  }));

  return (
    <>
      {/* Phone and tablet: a horizontal strip that scrolls. */}
      <header className="border-b border-black/[0.08] bg-rail lg:hidden">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Wordmark />
          <div className="flex-1" />
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <button className="text-xs text-black/45 hover:text-ink">Sign out</button>
          </form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-[7px] px-2.5 py-1.5 text-[13px] transition ${
                item.active
                  ? 'bg-black/[0.06] font-semibold text-ink'
                  : 'text-black/60 hover:bg-black/[0.04]'
              }`}
            >
              {item.label}
              {item.count !== null && (
                <span className="ml-1.5 text-[11px] tabular-nums text-black/35">
                  {item.count.toLocaleString()}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </header>

      {/* Desktop: the rail proper. */}
      <aside className="hidden w-[216px] shrink-0 flex-col gap-4 border-r border-black/[0.08] bg-rail p-3 lg:flex">
        <div className="px-2.5 pt-1.5">
          <Wordmark />
        </div>

        <nav className="flex flex-col gap-0.5">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`railitem ${item.active ? 'railitem-active' : ''}`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  item.active ? 'bg-accent' : 'bg-transparent'
                }`}
              />
              <span className="flex-1 truncate">{item.label}</span>
              {item.count !== null && (
                <span className="text-[11.5px] tabular-nums text-black/35">
                  {item.count.toLocaleString()}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 border-t border-black/[0.08] pt-3">
          <ThemeToggle />

          <div className="flex items-center gap-2 px-1">
            <span
              aria-hidden
              className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center
                         rounded-full bg-black/[0.07] text-[11px] font-semibold"
            >
              {displayName(profile).charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium">{displayName(profile)}</div>
              {/* A viewer needs to know why the buttons are missing before
                  they go looking for them. */}
              <div className="text-[11px] capitalize text-black/40">
                {profile.role === 'viewer' ? 'View only' : profile.role}
              </div>
            </div>
            <form action="/auth/signout" method="post">
              <button
                aria-label="Sign out"
                title="Sign out"
                className="text-black/30 transition hover:text-ink"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent
                   text-[12px] font-bold text-white"
      >
        EZ
      </span>
      <span className="text-[15px] font-semibold tracking-tight">EZcrm</span>
    </span>
  );
}
