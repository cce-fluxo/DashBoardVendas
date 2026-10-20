import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Os scripts leem JSON sem esquema (GraphQL do Pipefy, a própria API do dash)
  // e rodam à mão, uma vez. Tipar cada resposta custaria mais que o risco que
  // evita. O código de produção em src/ continua sem `any`.
  {
    files: ["scripts/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
