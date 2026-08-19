import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#12151a',
        paper: '#fbfaf8',
      },
    },
  },
  plugins: [],
} satisfies Config;
