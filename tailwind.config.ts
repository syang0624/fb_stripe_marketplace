import type { Config } from "tailwindcss";

// Facebook Marketplace-inspired design system.
// Gray canvas (#F0F2F5) with white cards, Facebook blue for primary actions,
// system font stack, and FB's neutral/status palette.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        paper: "#FFFFFF", // card surface
        ink: "#050505", // primary text
        mist: "#F0F2F5", // page background / subtle fills
        steel: "#E4E6EB", // secondary buttons / neutral chips
        line: "#DADDE1", // dividers
        fb: "#1877F2", // Facebook blue — primary actions
        fbdark: "#166FE5", // primary action hover
        positive: "#31A24C",
        critical: "#FA383E",
        // Back-compat aliases so any stray legacy class still resolves.
        primary: "#1877F2",
        secondary: "#E4E6EB"
      },
      fontFamily: {
        sans: [
          "Segoe UI",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "system-ui",
          "sans-serif"
        ],
        heading: ["Segoe UI", "Helvetica Neue", "Helvetica", "Arial", "system-ui", "sans-serif"],
        body: ["Segoe UI", "Helvetica Neue", "Helvetica", "Arial", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      borderRadius: {
        DEFAULT: "8px",
        md: "8px",
        lg: "10px"
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.1)",
        card: "0 1px 2px rgba(0,0,0,0.2)"
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
