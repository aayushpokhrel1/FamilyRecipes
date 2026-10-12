// Reads this app's routes.tsx and fails if a kitchen ACTION route escapes the terms gate.
//
// THIS EXISTS BECAUSE EVERY KITCHEN ROUTE ESCAPED IT. Plans 1 to 3 shipped the professional
// kitchen with every route behind RequireAuth and none behind any terms gate, so no kitchen
// user had accepted anything: not the terms, not the privacy page. The suite was green with
// 873 unit tests, because src/routes.terms.test.ts reads the FAMILY routes file and nothing
// read this one. A guard that covers one of two apps is a guard that reports success for the
// app it cannot see.
//
// Source-reading rather than behavioural, deliberately, and in the same spirit as
// src/routes.terms.test.ts and supabase/rls.test.ts: the defect is in the WIRING, and
// rendering the whole router to prove it would mock away the very composition under test.
import { expect, it } from "vitest";
// Vite's ?raw, not node:fs, so this test stays inside tsconfig.app.json, which has no node
// types on purpose.
import routes from "./routes.tsx?raw";

/**
 * Paths a visitor must reach WITHOUT having accepted anything. Everything else has to be
 * inside the gated band.
 *
 * This list is the deliberate part. A new public route is the moment to think about whether it
 * does something, so adding a line here should feel like a decision rather than a formality.
 */
const UNGATED = [
  // You cannot accept terms before you have an account to record the acceptance against.
  "/signin",
  "/signup",
  "/auth/callback",
  // A notice you can only read after consenting is not a notice. The family app keeps its four
  // public documents outside its gate for the same reason.
  "/terms",
  "/privacy",
];

function gatedBand(): string {
  const start = routes.indexOf("<Route element={<GatedLayout />}>");
  expect(
    start,
    "the gated layout is gone from routes.tsx, so this test is now checking nothing",
  ).toBeGreaterThan(-1);
  return routes.slice(start);
}

it("puts every route that DOES something inside the gated layout", () => {
  const gated = gatedBand();
  const all = Array.from(routes.matchAll(/path="([^"]+)"/g)).map((m) => m[1]);
  expect(all.length, "no routes found at all, so the regex has drifted from the file").toBeGreaterThan(0);
  const escaped = all.filter((p) => !UNGATED.includes(p) && !gated.includes(`path="${p}"`));
  expect(
    escaped,
    `${escaped.join(", ")} can be used without accepting the terms. Either move it inside ` +
      "GatedLayout or justify it in UNGATED above.",
  ).toEqual([]);
});

it("keeps /join/:code gated even though it is public", () => {
  // Joining an employer's group is an ACTION, and this is not a new judgement: the family app
  // learned it by shipping the opposite. Moving /join/:code out of RequireAuth so an invited
  // stranger could read the invitation moved it out of TermsGate too, and a signed-in cook who
  // had never accepted the terms could change their family memberships.
  expect(gatedBand()).toContain('path="/join/:code"');
});

it("leaves both documents readable without accepting them first", () => {
  const gated = gatedBand();
  for (const path of ["/terms", "/privacy"]) {
    expect(gated, `${path} is inside the gate, so it can only be read after consenting`).not.toContain(
      `path="${path}"`,
    );
  }
});

it("renders the gate exactly once, around an Outlet", () => {
  // One wrapper rather than one per route. Six wrappers would be six chances to forget the
  // seventh, and that is precisely the mistake this file was written after.
  expect(routes.match(/<GatedLayout \/>/g)).toHaveLength(1);
  expect(
    routes,
    "the gate is being applied per route again, which is the shape that lost a route last time",
  ).not.toContain("<KitchenTermsGate");
});
