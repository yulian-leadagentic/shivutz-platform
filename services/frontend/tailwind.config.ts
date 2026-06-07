import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary — BuildUp orange (logo #F78203 anchored at 600).
        // Replaces the previous indigo. Used for CTAs, accents, focus
        // rings, key data — see globals.css --primary mirrors.
        primary: {
          50:  '#fff8ed',
          100: '#ffeccc',
          200: '#ffd699',
          300: '#ffba66',
          400: '#fb9d33',
          500: '#f88b17',
          600: '#f78203',   // ← logo orange
          700: '#d26a02',
          800: '#a5530b',
          900: '#7a3d07',
          950: '#401e03',
        },
        // brand alias — identical to primary so utilities like
        // `text-brand-300` keep resolving in legacy components.
        brand: {
          50:  '#fff8ed',
          100: '#ffeccc',
          200: '#ffd699',
          300: '#ffba66',
          400: '#fb9d33',
          500: '#f88b17',
          600: '#f78203',   // ← logo orange
          700: '#d26a02',
          800: '#a5530b',
          900: '#7a3d07',
          950: '#401e03',
        },
        // Secondary brand — BuildUp navy (logo #022146 at 600). Used
        // for the wordmark "Build" half, dark hero/footer surfaces,
        // and any place we specifically want brand-navy (not generic
        // slate). Sidebar still uses neutral slate by design.
        navy: {
          50:  '#e8edf3',
          100: '#d1dbe7',
          200: '#a4b7cf',
          300: '#7693b7',
          400: '#4970a0',
          500: '#1e4d88',
          600: '#022146',   // ← logo navy
          700: '#021a38',
          800: '#01142b',
          900: '#010d1d',
          950: '#00060f',
        },
        // Surface tokens
        surface: {
          DEFAULT: '#ffffff',
          subtle:  '#f8fafc',
          muted:   '#f1f5f9',
        },
        // Sidebar
        sidebar: {
          bg:          '#0f172a',
          hover:       '#1e293b',
          active:      '#1e293b',
          'active-bar':'#f78203',   // brand orange accent
          text:        '#94a3b8',
          'text-active':'#f1f5f9',
          border:      '#1e293b',
        },
      },
      fontFamily: {
        sans: ['var(--font-heebo)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      boxShadow: {
        card:  '0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.07)',
        'card-md': '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07)',
        'card-focus': '0 0 0 3px rgb(247 130 3 / 0.15)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
