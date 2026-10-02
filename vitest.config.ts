import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    // Needed so `import css from "./index.css?raw"` returns the stylesheet instead of an empty
    // string: with Vitest's default css:false, every CSS import resolves to "". That import is
    // how src/index.contrast.test.ts measures the REAL colour tokens, which is the only way the
    // check cannot drift from the palette it is guarding.
    css: true,
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
