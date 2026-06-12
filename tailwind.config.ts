import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Libro mayor": warm paper surfaces, green-black ink, ledger-green accent
        paper: '#f6f4ee',
        surface: '#fdfcf8',
        ink: {
          DEFAULT: '#1b2420',
          soft: '#26322c',
          mute: '#5c6962',
        },
        tinta: '#232a26',
        accent: {
          DEFAULT: '#1f6f54',
          strong: '#15523d',
          soft: '#e7f0eb',
        },
        line: '#e3ded2',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(27, 36, 32, 0.06), 0 0 0 1px rgba(27, 36, 32, 0.04)',
        lift: '0 6px 24px -8px rgba(27, 36, 32, 0.18)',
      },
    },
  },
  plugins: [],
};

export default config;
