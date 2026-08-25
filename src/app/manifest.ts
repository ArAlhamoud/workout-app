import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aurora Health',
    short_name: 'Aurora',
    description: 'Track your 12-week fat loss program',
    start_url: '/',
    display: 'standalone',
    background_color: '#0A0F1E',
    theme_color: '#0A0F1E',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      // Next's Manifest type only accepts a single purpose token, so the
      // spec's 'any maskable' is split into two entries for the same file.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
