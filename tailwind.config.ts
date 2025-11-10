import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0B0F14',
        card: '#1F2937',
        violet: '#A78BFA',
        pampGreen: '#22C55E',
        pampAmber: '#F59E0B',
        pampRed: '#FF5A5F',
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
  plugins: [],
};

export default config;
