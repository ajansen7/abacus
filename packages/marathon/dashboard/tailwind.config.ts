import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#0b0c0e',
        panel: '#14161a',
        border: '#1f2228',
        muted: '#8a8f98',
      },
    },
  },
  plugins: [],
};

export default config;
