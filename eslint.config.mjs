import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  js.configs.recommended,

  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // Default normal .js files to CommonJS
  {
    files: ["**/*.js"],
    ignores: ["**/*.test.js", "**/*.spec.js"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },

  // Test files use ES modules because Vitest imports are ESM
  {
    files: ["**/*.test.js", "**/*.spec.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
      sourceType: "module",
    },
  },
]);
