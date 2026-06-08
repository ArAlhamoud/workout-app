import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import InstallPrompt from '@/components/InstallPrompt';
import WorkoutDraftBanner from '@/components/WorkoutDraftBanner';

const inter = Inter({ subsets: ['latin'] });

export const viewport: Viewport = {
  themeColor: '#0A0F1E',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: 'Workout Tracker',
  description: 'Track your 12-week fat loss program',
  manifest: '/manifest.webmanifest',
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
        <main className="mx-auto px-4 pt-5 pb-32 max-w-lg">
          {children}
        </main>
        <WorkoutDraftBanner />
        <Navbar />
        <InstallPrompt />
      </body>
    </html>
  );
}
