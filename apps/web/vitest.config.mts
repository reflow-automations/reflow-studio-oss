import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // `src/lib/studio/service.ts` starts with `import "server-only"` (a Next.js build-time guard); stub it out.
      { find: "server-only", replacement: here("./test/_stubs/server-only.ts") },
      { find: /^@\//, replacement: `${here("./src")}/` },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
