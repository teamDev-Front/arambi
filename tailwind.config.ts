import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  "#f2f6f0",
          100: "#dcebd6",
          200: "#b8d7ae",
          300: "#8dbc82",
          400: "#659c5a",
          500: "#4a7c3f",
          600: "#3a6230",
          700: "#2c4a24",
          800: "#1e321a",
          900: "#111c0f",
        },
        accent: {
          50:  "#fdf8ee",
          100: "#f7e9c8",
          200: "#edd28e",
          300: "#d9b455",
          400: "#c49830",
          500: "#a67c20",
          600: "#836016",
          700: "#60450f",
          800: "#3d2c09",
          900: "#1a1204",
        },
        surface: {
          DEFAULT: "#f5f0e8",
          card:    "#ffffff",
          dark:    "#2c3e2d",
        },
        sidebar: {
          bg:     "#2c3e2d",
          active: "#3a6230",
          text:   "#d4e8ce",
          muted:  "#7aa870",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
