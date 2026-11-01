import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees and copied sample files are not this app's source.
    ".claude/**",
    "public/samples/**",
    // Generated third-party archive worker, copied from node_modules.
    "public/archive/**",
    // Python dependencies and generated invoice artifacts are not frontend source.
    "backend/.venv/**",
    "backend/runtime/**",
    "backend/artifacts/**",
  ]),
]);

export default eslintConfig;
