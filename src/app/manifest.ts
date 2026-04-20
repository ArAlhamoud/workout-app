import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Workout Tracker',
    short_name: 'Workout',
    description: 'Track your 12-week fat loss program',
    start_url: '/',
    display: 'standalone',
    background_color: '#030712',
    theme_color: '#030712',
    orientation: 'portrait',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
      { src: '/apple-icon', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
