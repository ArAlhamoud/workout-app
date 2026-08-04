import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import InstallPrompt from '@/components/InstallPrompt';
import WorkoutDraftBanner from '@/components/WorkoutDraftBanner';
import DeepLinkHandler from '@/components/DeepLinkHandler';
import HealthAutoPilot from '@/components/HealthAutoPilot';

const inter = Inter({ subsets: ['latin'] });

export const viewport: Viewport = {
  themeColor: '#05060f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Required for env(safe-area-inset-*) to report real values — without it the
  // native shell draws the header under the status bar and the nav under the
  // home indicator.
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Workout Tracker',
  description: 'Track your 12-week fat loss program',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Workout',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-app-bg text-app-tx1 min-h-screen`}>
        {/* Aurora backdrop — single fixed layer behind the scrolling app */}
        <div className="aurora-sky" aria-hidden="true" />
        <main className="mx-auto px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-32 max-w-lg">
          {children}
        </main>
        <DeepLinkHandler />
        <HealthAutoPilot />
        <WorkoutDraftBanner />
        <Navbar />
        <InstallPrompt />
      </body>
    </html>
  );
}
