import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import InstallPrompt from '@/components/InstallPrompt';

const inter = Inter({ subsets: ['latin'] });

export const viewport: Viewport = {
  themeColor: '#030712',
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
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        <main className="mx-auto px-4 pt-6 pb-24 max-w-lg">
          {children}
        </main>
        <Navbar />
        <InstallPrompt />
      </body>
    </html>
  );
}
