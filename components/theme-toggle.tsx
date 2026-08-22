'use client';

import { useEffect, useState } from 'react';

const KEY = 'ezcrm-theme';
const MODES = ['light', 'system', 'dark'] as const;
type Mode = (typeof MODES)[number];

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function apply(mode: Mode) {
  const dark = mode === 'dark' || (mode === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

/**
 * Light / System / Dark, as a segmented control.
 *
 * System is a real third state rather than the absence of a choice: someone
 * whose laptop flips to dark in the evening should get that without having to
 * come back here, and someone who wants it light at night should be able to
 * pin it. The initial class is set by the inline script in app/layout.tsx —
 * this only reflects and changes it.
 */
export function ThemeToggle() {
  // Starts null so the first client render matches the server's, which knows
  // nothing about localStorage. Rendering the real state before mount would
  // trip a hydration mismatch.
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(KEY) as Mode | null;
    setMode(stored && MODES.includes(stored) ? stored : 'system');
  }, []);

  // Only while following the system: track changes live, so the app switches
  // when the OS does rather than at the next reload.
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const choose = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private browsing with storage blocked. The theme still applies for
      // this page view; it just won't be remembered.
    }
    apply(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-full border border-black/10 p-0.5"
    >
      {MODES.map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          aria-label={m === 'system' ? 'Match system theme' : `${m} theme`}
          title={m === 'system' ? 'Match system' : m[0].toUpperCase() + m.slice(1)}
          onClick={() => choose(m)}
          className={`rounded-full p-1.5 transition ${
            mode === m ? 'bg-ink text-white' : 'text-black/40 hover:bg-black/[0.06] hover:text-ink'
          }`}
        >
          <Icon mode={m} />
        </button>
      ))}
    </div>
  );
}

function Icon({ mode }: { mode: Mode }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (mode === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }

  if (mode === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
