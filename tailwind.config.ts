import type { Config } from "tailwindcss";

const color = (token: string) => "rgb(var(--" + token + ") / <alpha-value>)";

export default {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: color("background"),
        foreground: color("foreground"),
        card: { DEFAULT: color("card"), foreground: color("card-foreground") },
        popover: { DEFAULT: color("popover"), foreground: color("popover-foreground") },
        primary: {
          DEFAULT: color("primary"),
          foreground: color("primary-foreground"),
          hover: color("primary-hover"),
        },
        secondary: { DEFAULT: color("secondary"), foreground: color("secondary-foreground") },
        muted: { DEFAULT: color("muted"), foreground: color("muted-foreground") },
        accent: { DEFAULT: color("accent"), foreground: color("accent-foreground") },
        destructive: { DEFAULT: color("destructive"), foreground: color("destructive-foreground") },
        border: color("border"),
        input: color("input"),
        ring: color("ring"),
        success: color("success"),
        warning: color("warning"),
        obsidian: "#09090b",
        surface: "#121214",
        "surface-card": "#18181b",
        gold: {
          DEFAULT: "#c08818",
          hover: "#d49b28",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
    },
  },
  plugins: [],
} satisfies Config;
