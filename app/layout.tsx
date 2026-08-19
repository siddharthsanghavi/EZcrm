import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EZcrm',
  description: 'Club outreach tracker for tours and sponsorships',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
