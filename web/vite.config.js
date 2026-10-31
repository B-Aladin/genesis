import { defineConfig } from "vite";

// `npm run dev` serves the UI on :5173 and forwards API calls to the Python bench on :8000.
// `npm run build` writes web/dist, which `python -m genesis_see.web` serves on its own.
export default defineConfig({
  resolve: {
    // netlistsvg asks for "elkjs"; the self-contained bundle runs in the browser without a worker file
    alias: { elkjs: "elkjs/lib/elk.bundled.js" },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/files": "http://127.0.0.1:8000",
    },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1600 },
});
