// Reads routes.tsx itself and fails if an ACTION route escapes the terms gate.
//
// This exists because one did. Moving /join/:code out of RequireAuth, so an invited stranger
// with no account could read the invitation, also moved it out of TermsGate, and a signed-in
// cook who had never accepted the terms could change their family memberships. Caught in a
// browser, not by the 690 tests that were green at the time.
//
// Source-reading rather than behavioural, deliberately, and in the same spirit as
// supabase/rls.test.ts: the defect is in the WIRING, and rendering the whole router to prove
// it would mock away the very composition under test.
import { describe, expect, it } from "vitest";
// Vite's ?raw, not node:fs, so this test stays inside tsconfig.app.json, which has no node
// types on purpose.
import routes from "./routes.tsx?raw";

// Routes a signed-out visitor must be able to READ. Everything else that is public has to
// justify itself here.
const PUBLIC_AND_UNGATED = [
  "recipes/:id",   // a shared recipe link must open without a session
  "cooks/:handle", // the same, for a published cook's page
  "terms", "privacy", "cookies", "help", // a notice you can only read after consenting is not one
];

describe("the terms gate covers every route that DOES something", () => {
  it("keeps the join route behind TermsGate even though it is public", () => {
    const line = routes.split("\n").find((l) => l.includes('path="join/:code"'));
    expect(line, "the join route disappeared, so this test is now checking nothing").toBeDefined();
    expect(line).toContain("TermsGate");
  });

  // A new public route is the moment to think about this, so the list above has to be edited
  // deliberately rather than drifting.
  it("has no public route that is neither gated nor on the readable list", () => {
    const publicBlock = routes.slice(
      routes.indexOf("<Route element={<AppLayout />}>"),
      routes.indexOf("<RequireAuth>"),
    );
    const paths = Array.from(publicBlock.matchAll(/path="([^"]+)"/g)).map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      if (PUBLIC_AND_UNGATED.includes(p)) continue;
      const line = publicBlock.split("\n").find((l) => l.includes(`path="${p}"`))!;
      expect(line, `${p} is public but neither gated nor listed as readable`).toContain("TermsGate");
    }
  });
});
