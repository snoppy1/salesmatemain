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
        // muted/accent ใช้รูป rgb(var / <alpha-value>) — ให้ตัวปรับความจาง (เช่น bg-accent/15) ทำงานจริง
        // (ใส่ var เปล่าๆ จะทำให้ Tailwind ตัด alpha ทิ้งเงียบๆ → สี active/ป้ายเพี้ยน)
        muted: "rgb(var(--text-muted-rgb) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          contrast: "var(--accent-contrast)",
        },
        // สีรอง "เนื้อทราย" — ป้ายไอคอน/ชิป/แท่งกราฟฝั่งการกระทำของ AI (คู่กับ accent เขียว)
        sand: "rgb(var(--sand-rgb) / <alpha-value>)",
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
