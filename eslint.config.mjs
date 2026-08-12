import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships flat config directly, so it is spread in rather
 * than wrapped in FlatCompat (which cannot serialise it and throws).
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "coverage/**",
      "src/styles/tokens.css",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // The learning engine is pure code; an accidental `any` there is a real
      // defect rather than a style preference.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
