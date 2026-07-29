import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // App design tokens via CSS variables
        app: {
          bg:        'var(--app-bg)',
          surface:   'var(--app-surface)',
          surface2:  'var(--app-surface2)',
          border:    'var(--app-border)',
          tx1:       'var(--app-tx1)',
          tx2:       'var(--app-tx2)',
          tx3:       'var(--app-tx3)',
          primary:   'var(--app-primary)',
          'primary-muted': 'var(--app-primary-muted)',
        },
      },
      boxShadow: {
        card:    '0 1px 3px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.25)',
        'card-lg': '0 2px 8px rgba(0,0,0,0.6), 0 8px 32px rgba(0,0,0,0.35)',
        'glow-blue':   '0 0 20px rgba(59,130,246,0.25)',
        'glow-violet': '0 0 20px rgba(139,92,246,0.25)',
        'glow-teal':   '0 0 20px rgba(45,212,191,0.2)',
      },
      borderRadius: {
        card: '1rem',
        'card-lg': '1.375rem',
      },
    },
  },
  plugins: [],
};

export default config;
