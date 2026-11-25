import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "test-results/**",
    "test-results-e2e-suite/**",
    "playwright-report/**",
    "playwright-report-e2e-suite/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
