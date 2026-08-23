import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';

/**
 * Self-hosted at build time by next/font, so there is no request to Google at
 * runtime and no layout shift while it loads. `variable` feeds the Tailwind
 * font stack; the fallbacks below it in tailwind.config.ts still apply if the
 * face fails to load.
 */
const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-archivo',
});

export const metadata: Metadata = {
  title: 'EZcrm',
  description: 'Club outreach tracker for tours and sponsorships',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf8' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
  ],
};

/**
 * Applies the saved theme before the first paint.
 *
 * This has to be a blocking inline script in <head>. Doing it in a component
 * effect would let the light theme paint first, so anyone on dark mode gets a
 * white flash on every single navigation. Kept deliberately tiny, and wrapped
 * in try/catch because localStorage throws outright when cookies are blocked.
 */
const APPLY_THEME = `
(function(){try{
  var t = localStorage.getItem('ezcrm-theme') || 'system';
  var dark = t === 'dark' || (t === 'system' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script above edits <html>'s class list
    // before React hydrates, so the server and client markup differ by design.
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
