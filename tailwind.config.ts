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
      // P1-49: Manage booking progress bar. Used only behind motion-safe:.
      keyframes: {
        "zeus-shine": { "0%": { transform: "translateX(-120%)" }, "60%, 100%": { transform: "translateX(420%)" } },
        "zeus-ring": { "0%": { transform: "scale(1)", opacity: "0.7" }, "100%": { transform: "scale(1.7)", opacity: "0" } },
        "zeus-fade": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "zeus-shine": "zeus-shine 2.6s ease-in-out 1.4s infinite",
        "zeus-ring": "zeus-ring 1.9s ease-out 1.4s infinite",
        "zeus-fade": "zeus-fade 400ms ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
