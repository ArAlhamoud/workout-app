import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts}', // class maps (CATEGORY_BADGE, RPE_COLORS) live here
  ],
  theme: {
    extend: {
      colors: {
        // App design tokens via CSS variables (glass-friendly rgba values)
        app: {
          bg:        'var(--app-bg)',
          'bg-hi':   'var(--app-bg-hi)',
          surface:   'var(--app-surface)',
          surface2:  'var(--app-surface2)',
          glass:     'var(--app-glass-solid)',
          border:    'var(--app-border)',
          'border-hi': 'var(--app-border-hi)',
          tx1:       'var(--app-tx1)',
          tx2:       'var(--app-tx2)',
          tx3:       'var(--app-tx3)',
          primary:   'var(--app-primary)',
          'primary-muted': 'var(--app-primary-muted)',
        },
        // Aurora data accents — literal hex so opacity modifiers work (bg-acc-teal/10)
        acc: {
          violet:        '#c4b5fd', // Day A
          'violet-deep': '#8b5cf6',
          teal:          '#5eead4', // Day B · body weight
          'teal-deep':   '#14b8a6',
          cyan:          '#67e8f9',
          indigo:        '#4f46e5',
          ember:         '#fcd34d', // Return Protocol ONLY
          'ember-deep':  '#f59e0b',
          gold:          '#fde047', // PRs
        },
        // Effort spectrum
        rpe: {
          easy:  '#34d399',
          med:   '#fbbf24',
          hard:  '#fb923c',
          grind: '#f43f5e',
        },
      },
      boxShadow: {
        card:      'inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 40px -22px rgba(0,0,0,0.6)',
        'card-lg': 'inset 0 1px 0 rgba(255,255,255,0.16), 0 24px 48px -24px rgba(0,0,0,0.7)',
        nav:       'inset 0 1px 0 rgba(255,255,255,0.12), 0 18px 40px -18px rgba(0,0,0,0.8)',
        'glow-blue':   '0 0 20px rgba(99,102,241,0.35)',
        'glow-violet': '0 0 24px -4px rgba(139,92,246,0.6)',
        'glow-teal':   '0 0 24px -4px rgba(45,212,191,0.6)',
        'glow-ember':  '0 0 24px -4px rgba(245,158,11,0.6)',
        'glow-gold':   '0 0 24px -4px rgba(250,204,21,0.6)',
      },
      borderRadius: {
        card: '1rem',
        'card-lg': '1.375rem',
      },
      fontFamily: {
        round: [
          'ui-rounded',
          '"SF Pro Rounded"',
          '-apple-system',
          '"Helvetica Neue"',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
