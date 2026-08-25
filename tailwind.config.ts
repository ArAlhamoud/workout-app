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
        // Chroma ink — the outline color of everything
        ink: '#0b0b0f',
        // Chroma data accents — literal hex so opacity modifiers work
        // (bg-acc-teal/10). Base = text-safe dark; -deep = saturated fill.
        acc: {
          violet:        '#6d28d9', // Day A (text)
          'violet-deep': '#8b5cf6', // Day A (fill)
          teal:          '#0f766e', // Day B · body weight (text)
          'teal-deep':   '#14b8a6', // fill
          cyan:          '#0e7490', // health module (text)
          indigo:        '#4f46e5',
          ember:         '#b45309', // Return Protocol ONLY (text)
          'ember-deep':  '#f59e0b', // fill
          gold:          '#a16207', // PRs
        },
        // Effort spectrum — darker for ink-on-bone legibility
        rpe: {
          easy:  '#15803d',
          med:   '#b45309',
          hard:  '#c2410c',
          grind: '#d6336c',
        },
      },
      boxShadow: {
        // Chroma: offset solid ink, never blur
        card:      '4px 4px 0 #0b0b0f',
        'card-lg': '5px 5px 0 #0b0b0f',
        nav:       '0 -2px 0 #0b0b0f',
        'glow-blue':   '3px 3px 0 #0b0b0f',
        'glow-violet': '3px 3px 0 #0b0b0f',
        'glow-teal':   '3px 3px 0 #0b0b0f',
        'glow-ember':  '3px 3px 0 #0b0b0f',
        'glow-gold':   '3px 3px 0 #0b0b0f',
      },
      borderRadius: {
        card: '0.875rem',
        'card-lg': '1rem',
      },
      fontFamily: {
        round: [
          'Archivo',
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
