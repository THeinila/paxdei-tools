import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  // Inline the toolkit (release-train) version at build time so the UI can show it
  // without bundling package.json or relying on npm_package_version.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: Number(process.env.PORT) || 5173,
    // Same-origin API in dev; the backend runs on 8787 (npm run server).
    proxy: { "/api": "http://localhost:8787" },
  },
});
