import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `set-state-in-effect` (React-compiler RC rule, shipped via eslint-config-next) is
      // overly aggressive for our legitimate client-only init effects — reading
      // localStorage/sessionStorage must happen in an effect to avoid a hydration mismatch,
      // so the synchronous setState there is intentional. Keep it visible as a warning
      // rather than a CI-blocking error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone Node.js scripts — not Next.js, React hooks rules don't apply.
    "claw-ingester/**",
    "openclaw/**",
  ]),
]);

export default eslintConfig;
