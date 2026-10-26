import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": "off",
    },
  },
  {
    ignores: [
      "reference-source/**",
      "node_modules/**",
      "dist/**",
      "web/editor-bundle.js",
      "web/diagram-worker.js",
    ],
  },
];
