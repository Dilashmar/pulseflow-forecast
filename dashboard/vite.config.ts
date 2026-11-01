import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The pipeline writes output/*.json at the project root. Importing them through
// this alias lets Vite bundle the committed files into the dashboard build.
const outputDir = fileURLToPath(new URL("../output", import.meta.url));
// Tests read a frozen copy of the 2026-10-15 output instead, so their expected
// numbers stay true when a new week's run rewrites output/. Only liveParity.test.ts
// reads the live folder.
const fixtureDir = fileURLToPath(new URL("./test-fixtures/output", import.meta.url));

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
    alias: { "@output": fixtureDir },
  },
});
