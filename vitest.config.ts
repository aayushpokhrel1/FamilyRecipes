import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Vitest defaults to 5000ms. The integration tests talk to a real Postgres over HTTP and
    // several of them create four or five users, and they had begun failing in clusters at
    // 5000 to 5100ms: a TIMEOUT reads exactly like an assertion failure, which sent one
    // session hunting a bug that was not there. Raising the ceiling costs a passing test
    // nothing, since it only changes how long a HUNG test waits, and it removes the whole
    // class rather than annotating tests one at a time as they drift over the line.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
