import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';
import JourneyNav from '@/components/JourneyNav';
import InstallPrompt from '@/components/InstallPrompt';
import WorkoutDraftBanner from '@/components/WorkoutDraftBanner';
import DeepLinkHandler from '@/components/DeepLinkHandler';
import HealthAutoPilot from '@/components/HealthAutoPilot';

// Chroma's voice: Archivo, one variable family — 900 for display, 500-700
// for body and labels.
const archivo = Archivo({ subsets: ['latin'] });

export const viewport: Viewport = {
  themeColor: '#f2f0ea',
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
  title: 'AR Health',
  description: 'Track your 12-week fat loss program',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    // Light ground wants dark status-bar text.
    statusBarStyle: 'default',
    title: 'AR Health',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${archivo.className} bg-app-bg text-app-tx1 min-h-screen`}>
        {/* Chroma ground — flat bone, one fixed layer */}
        <div className="aurora-sky" aria-hidden="true" />
        <main className="mx-auto px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-32 max-w-lg">
          {children}
        </main>
        <DeepLinkHandler />
        <HealthAutoPilot />
        <WorkoutDraftBanner />
        <JourneyNav />
        <InstallPrompt />
      </body>
    </html>
  );
}
