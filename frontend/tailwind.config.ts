import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#090d14',
        panel: '#101720',
        line: '#263140',
        signal: '#40e0d0',
        flare: '#ff6b4a',
        mist: '#9aa9b8',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        display: ['Manrope', 'Inter', 'ui-sans-serif'],
      },
      boxShadow: { signal: '0 0 0 1px rgba(64,224,208,.2), 0 18px 60px rgba(0,0,0,.35)' },
    },
  },
  plugins: [],
} satisfies Config;
