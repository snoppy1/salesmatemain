import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // semantic tokens (map to CSS vars; flip on .dark)
        app: "var(--app)",
        surface: "var(--surface)",
        surface2: "var(--surface-2)",
        line: "var(--line)",
        fg: "var(--text)",
        muted: "var(--text-muted)",
        accent: {
          DEFAULT: "var(--accent)",
          contrast: "var(--accent-contrast)",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "var(--font-plex-thai)",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
