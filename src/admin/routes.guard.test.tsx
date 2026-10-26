// Reads this app's routes.tsx and fails if any route escapes the moderator gate.
//
// THIS IS THE THIRD GUARD, AND IT EXISTS BECAUSE THE SECOND ONE WAS MISSING ONCE. The
// professional kitchen shipped plans 1 to 3 with every route behind RequireAuth and none behind
// any terms gate, so no kitchen user had accepted anything, and the suite was green with 873
// unit tests because `src/routes.terms.test.ts` reads the FAMILY routes file and nothing read
// the kitchen's. A guard that covers two of three apps reports success for the app it cannot
// see, and this time the app it could not see would be the moderation console.
//
// WHAT THIS ASSERTS IS NOT "terms", and the difference is deliberate. The other two apps gate on
// terms acceptance because they are consumer products. This app has no terms gate and no
// documents: it is an operator tool. What the other guards really assert is "no route that DOES
// something escapes the gate this app has", and the gate this app has is RequireModerator.
//
// Source-reading rather than behavioural, in the same spirit as `src/routes.terms.test.ts`,
// `src/kitchen/routes.terms.test.tsx` and `supabase/rls.test.ts`: the defect being guarded
// against is in the WIRING, and rendering the whole router to prove it would mock away the very
// composition under test.
import { expect, it } from "vitest";
// Vite's ?raw, not node:fs, so this test stays inside tsconfig.app.json, which has no node types
// on purpose.
import routes from "./routes.tsx?raw";

/**
 * The ONLY path allowed outside the gate.
 *
 * This list is the deliberate part. Adding a line here should feel like a decision, because on
 * this host it is: every other route is a moderation surface, and there is no such thing as a
 * public page in a moderation console.
 */
const UNGATED = [
  // Telling someone a page does not exist is not an action. Gating it would send a signed-out
  // visitor through a sign-in that does not exist on this host to be told their link is dead.
  "*",
];

// Every `path="..."` in the file, in source order, with the string that follows it, so a route's
// position relative to the guards can be read rather than assumed.
function routePaths(): string[] {
  return [...routes.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
}

it("has routes to read, since an empty list would guard nothing", () => {
  // The failure this prevents is the quiet one: a refactor renames the file or changes the
  // attribute style, every regex below matches nothing, and the suite reports success for a
  // check that has stopped looking at anything.
  expect(routePaths().length).toBeGreaterThan(1);
});

it("wraps every route that is not the catch-all in RequireModerator", () => {
  for (const path of routePaths()) {
    if (UNGATED.includes(path)) continue;
    // The element for this route, taken as the text between its path and the next route.
    const start = routes.indexOf(`path="${path}"`);
    const rest = routes.slice(start);
    const end = rest.indexOf('path="', 1);
    const element = end === -1 ? rest : rest.slice(0, end);
    expect(
      element,
      `the route "${path}" is not behind RequireModerator, so a signed-in non-moderator can reach it`,
    ).toContain("RequireModerator");
  }
});

it("wraps every route that is not the catch-all in RequireAuth too", () => {
  // RequireModerator reads the profile and fails closed, so it would refuse a signed-out
  // visitor anyway. RequireAuth is still required, because it is what sends them to sign in
  // WITH the destination in the URL rather than showing them "Not found" and stopping.
  for (const path of routePaths()) {
    if (UNGATED.includes(path)) continue;
    const start = routes.indexOf(`path="${path}"`);
    const rest = routes.slice(start);
    const end = rest.indexOf('path="', 1);
    const element = end === -1 ? rest : rest.slice(0, end);
    expect(element, `the route "${path}" is not behind RequireAuth`).toContain("RequireAuth");
  }
});

it("imports no terms gate, so nobody adds one here by reflex", () => {
  // Not a style rule. TermsGate reaches lib/api/profile for the family app's acceptance record,
  // and an operator tool asking an operator to accept the family app's terms to moderate would
  // be recording a consent that means nothing. If this app ever needs a gate, it needs its own
  // decision rather than the nearest import.
  expect(routes).not.toContain("TermsGate");
});
