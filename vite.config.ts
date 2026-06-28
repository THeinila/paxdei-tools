import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in dev; the backend runs on 8787 (npm run server).
    proxy: { "/api": "http://localhost:8787" },
  },
});
