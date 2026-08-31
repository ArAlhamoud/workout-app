import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';
import JourneyNav from '@/components/JourneyNav';
import DomainTheme from '@/components/DomainTheme';
import WorkoutDraftBanner from '@/components/WorkoutDraftBanner';
import DeepLinkHandler from '@/components/DeepLinkHandler';
import HealthAutoPilot from '@/components/HealthAutoPilot';

// Chroma's voice: Archivo, one variable family — 900 for display, 500-700
// for body and labels.
// `variable` matters: --font-round in globals.css names 'Archivo'
// literally, but next/font registers the family under a private hashed
// name — so display text silently fell back to system fonts everywhere
// (on iOS the fallback + text-stroke + synthetic bold painted the volt
// letters as two overlapping glyphs — owner's screenshot, Aug 31).
const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo' });

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
    <html lang="en" suppressHydrationWarning>
      <body className={`${archivo.className} ${archivo.variable} bg-app-bg text-app-tx1 min-h-screen`}>
        {/* Volt/Aurora domain switch before first paint — a hard load of a
            training route must never flash bone. Kept in sync with
            VOLT_ROUTES in DomainTheme.tsx. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(/^\\/(train|program|stats|workouts|progress|exercises)(\\/|$)/.test(location.pathname))document.documentElement.dataset.domain='volt'}catch(e){}",
          }}
        />
        <DomainTheme />
        {/* Chroma ground — flat bone, one fixed layer */}
        <div className="aurora-sky" aria-hidden="true" />
        <main className="mx-auto px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-32 max-w-lg">
          {children}
        </main>
        <DeepLinkHandler />
        <HealthAutoPilot />
        <WorkoutDraftBanner />
        <JourneyNav />
      </body>
    </html>
  );
}
