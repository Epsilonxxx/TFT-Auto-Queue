import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src-renderer/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      borderRadius: {
        xl: "16px"
      },
      colors: {
        background: "#f6f8fb",
        foreground: "#0f172a",
        card: "#ffffff",
        muted: "#64748b",
        primary: "#2563eb",
        border: "#e2e8f0"
      },
      boxShadow: {
        card: "0 8px 24px rgba(15, 23, 42, 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
