import { defineConfig } from "vite";
import { sites } from "@openai/sites-vite-plugin";
import { localApi } from "./server/local.js";

export default defineConfig({
  plugins: [sites(), localApi()],
  build: {
    ssr: "server.js",
    outDir: "dist",
    rollupOptions: { output: { entryFileNames: "server/index.js" } },
  },
});
