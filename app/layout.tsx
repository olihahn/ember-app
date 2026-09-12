import type { Metadata, Viewport } from 'next';
import { PwaSupport } from '@/components/PwaSupport';
import './globals.css';
import './ember.css';

export const metadata: Metadata = {
  title: 'Ember — Your cigar journal',
  description:
    'Remember the cigar, the place, and the moment. Your personal cigar journal with photo identification, ratings, notes, and an origin atlas.',
  applicationName: 'Ember',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.svg', apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, title: 'Ember', statusBarStyle: 'default' },
  openGraph: {
    title: 'Ember — Your cigar journal',
    description:
      'The cigar, the place, the moment. A personal collection, one entry at a time.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ember — Your cigar journal',
    description:
      'The cigar, the place, the moment. A personal collection, one entry at a time.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f6f1e4',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaSupport />
      </body>
    </html>
  );
}
