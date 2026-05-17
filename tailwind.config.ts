import type { Config } from "tailwindcss";

// Design tokens carried forward from index.html (CLAUDE.md hard rule #7).
const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0B1538",
          2: "#0F1B47",
          3: "#142255",
        },
        lime: {
          DEFAULT: "#C7FF3D",
          dim: "#A8D932",
        },
        rarity: {
          uncommon: "#319236",
          rare: "#4C51F7",
          epic: "#C80715",
          legendary: "#F5A623",
        },
      },
      fontFamily: {
        display: ["Anton", "Impact", "sans-serif"],
        body: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      screens: {
        sm: "480px",   // matches index.html small-mobile breakpoint
        md: "768px",   // matches index.html mobile→tablet breakpoint
        lg: "992px",   // matches index.html tablet→desktop breakpoint
      },
    },
  },
  plugins: [],
};

export default config;
