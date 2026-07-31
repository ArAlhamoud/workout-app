import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Remote-mode shell: the native app loads the deployed Vercel PWA directly,
 * so `webDir` is unused (but must exist — `public/` satisfies the CLI).
 */
const config: CapacitorConfig = {
  appId: 'com.aralhamoud.workout',
  appName: 'Workout',
  webDir: 'public',
  server: {
    url: 'https://workout-app-gamma-rouge.vercel.app',
    allowNavigation: [
      'workout-app-gamma-rouge.vercel.app',
      '*.vercel.app',
      'www.youtube.com',
      'youtube.com',
    ],
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;
