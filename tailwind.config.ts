import type { Config } from 'tailwindcss';

/**
 * The whole design is "ink on paper": text, borders, and hovers are all
 * opacities of black over a white surface. So dark mode is not 190 `dark:`
 * variants — it is a redefinition of what black and white *mean*.
 *
 *   black   -> the foreground ink   (near-white once dark)
 *   white   -> the raised surface   (near-black once dark)
 *
 * Every existing `text-black/45`, `border-black/10`, and `bg-white` then
 * inverts correctly on its own. The consequence to remember: `text-white` is
 * NOT a literal white any more. On `.btn-primary` (`bg-ink text-white`) that is
 * exactly right — it yields a light button with dark text in dark mode. If you
 * ever need a real, un-theming white, write `text-[#fff]`.
 */
export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        black: 'rgb(var(--fg) / <alpha-value>)',
        white: 'rgb(var(--surface) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',

        // Semantic accents. Named by meaning rather than hue so the dark theme
        // can lighten them without every call site having to know.
        danger: 'rgb(var(--danger) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
      },
    },
  },
  plugins: [],
} satisfies Config;
