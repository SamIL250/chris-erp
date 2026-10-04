import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Must come last: disables all ESLint rules that conflict with Prettier.
  prettier,
  {
    rules: {
      // Convention: intentionally unused params/vars are prefixed with `_`.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Untitled UI source (copied via CLI) — kept pristine for `untitledui upgrade`.
    // It intentionally uses plain <img> for avatars/media with dynamic sources.
    files: ["components/base/**/*.{ts,tsx}", "components/application/**/*.{ts,tsx}"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Convex-generated bindings:
    "convex/_generated/**",
  ]),
]);

export default eslintConfig;
