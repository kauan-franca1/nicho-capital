import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ADR 0004: nenhuma cor literal fora de src/styles/tokens.css.
const COLOR_LITERAL = String.raw`/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\(/`;
const colorMessage =
  "Cor literal proibida: use um token de src/styles/tokens.css (utilitário Tailwind ou var(--...)).";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=${COLOR_LITERAL}]`, message: colorMessage },
        { selector: `TemplateElement[value.raw=${COLOR_LITERAL}]`, message: colorMessage },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**"]),
]);

export default eslintConfig;
