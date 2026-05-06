import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const env = (key, fallback) => JSON.stringify(process.env[key] || fallback);

export default defineConfig({
  plugins: [react()],
  server: { port: 3000, host: "0.0.0.0" },
  define: {
    "import.meta.env.VITE_LIVE_DATA_URL":  env("VITE_LIVE_DATA_URL",  "http://localhost:8096"),
    "import.meta.env.VITE_ANALYSIS_URL":   env("VITE_ANALYSIS_URL",   "http://localhost:8088"),
    "import.meta.env.VITE_BACKTEST_URL":   env("VITE_BACKTEST_URL",   "http://localhost:8089"),
    "import.meta.env.VITE_AI_ADVISOR_URL": env("VITE_AI_ADVISOR_URL", "http://localhost:8094"),
    "import.meta.env.VITE_NET_WORTH_URL":  env("VITE_NET_WORTH_URL",  "http://localhost:8093"),
    "import.meta.env.VITE_IBKR_URL":       env("VITE_IBKR_URL",       "http://localhost:8091"),
    "import.meta.env.VITE_PLAID_URL":      env("VITE_PLAID_URL",      "http://localhost:8092"),
    "import.meta.env.VITE_SENTIMENT_URL":  env("VITE_SENTIMENT_URL",  "http://localhost:8097"),
    "import.meta.env.VITE_FINGPT_URL":     env("VITE_FINGPT_URL",     "http://localhost:8098"),
    "import.meta.env.VITE_ALERTS_URL":     env("VITE_ALERTS_URL",     "http://localhost:8095"),
  },
});
