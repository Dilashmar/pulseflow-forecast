import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The pipeline writes output/*.json at the project root. Importing them through
// this alias lets Vite bundle the committed files into the dashboard build.
const outputDir = fileURLToPath(new URL("../output", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@output": outputDir },
  },
  server: {
    fs: { allow: [".", outputDir] },
  },
  test: {
    environment: "node",
  },
});
