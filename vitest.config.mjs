import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/frontend/**", // frontend has its own Vitest config
    ],
  },
});
