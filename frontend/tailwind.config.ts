import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Exact palette from the MissionDoc AI brief.
        background: "#070B18",
        surface: "#111827",
        "surface-hover": "#161F31",
        primary: "#6366F1",
        accent: "#8B5CF6",
        success: "#22C55E",
        foreground: "#F8FAFC",
        muted: "#94A3B8",
        border: "#1E293B",
      },
      fontFamily: {
        display: ["var(--font-unbounded)", "sans-serif"],
        body: ["var(--font-ibm-plex-sans)", "sans-serif"],
        mono: ["var(--font-ibm-plex-mono)", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
