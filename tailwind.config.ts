import type { Config } from "tailwindcss";

// Stripe-inspired minimalist (Swiss) design system.
// Monochrome base + restrained status accents. Negative space and typographic
// hierarchy carry the structure; borders/shadows are used sparingly.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        paper: "#FFFFFF",
        ink: "#111111",
        mist: "#F5F5F7",
        line: "#E5E5E5",
        // Restrained status accents — used only for small text/dots.
        positive: "#067647",
        critical: "#B42318",
        // Back-compat aliases so any stray legacy class still resolves to ink/mist.
        primary: "#111111",
        secondary: "#F5F5F7"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        heading: ["Inter", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        mono: ["Inter", "system-ui", "sans-serif"]
      },
      borderRadius: {
        DEFAULT: "6px",
        md: "6px",
        lg: "8px"
      },
      boxShadow: {
        // Max 4px blur, very low opacity. No large/offset shadows.
        sm: "0px 1px 2px rgba(0,0,0,0.04)",
        card: "0px 2px 4px rgba(0,0,0,0.05)"
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        pulseDot: {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "1" }
        }
      },
      animation: {
        fadeIn: "fadeIn 0.25s ease-out",
        pulseDot: "pulseDot 1.1s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
