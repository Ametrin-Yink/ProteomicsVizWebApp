import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  // Global ignores — MUST be first standalone object to apply globally
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "node_modules/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
];

export default eslintConfig;
