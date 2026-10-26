import { describe, expect, it } from "vitest";
// The same glob the storage and accessibility audits read, for the same reason: a test living
// in src/ is covered by tsconfig.app.json, which deliberately has no node types, so node:fs is
// not available here and should not be.
import { sources, type SourceFile } from "./sourceFiles";

// EVERY READ OF `next` MUST GO THROUGH safeNext, AND THIS IS WHAT SAYS SO.
//
// `safeNext` is a trust boundary, not a tidy-up: the parameter arrives from a URL anybody can
// write, and a sign-in page that navigates to it unchecked is an open redirector that lands a
// freshly authenticated person on somebody else's copy of itself. The unit tests next door
// prove the function REFUSES a hostile value. They cannot prove it is CALLED, and a call site
// that forgets it is the only way this gets back in.
//
// Every read in both apps was correct when this was written: an audit unit on 2026-10-13 went
// through all of them looking for an open redirect and found none. That is the reason to write
// the guard now rather than later. A clean surface is one commit away from not being, and
// nothing stopped the next call site from reading the parameter raw.
//
// A source scan rather than a behavioural test, because the hole is an ABSENCE. A test that
// drives a page can only cover the call sites somebody remembered to write a test for, which
// is the same forgetting, one level up. The same reasoning as src/routes.terms.test.ts.
const READS_NEXT = /\.get\(\s*["']next["']\s*\)/;
// safeReturnUrl is the THIRD name, added 2026-10-26, and it belongs here rather than as an
// exception: it is a validator too, a deliberately narrower one for the single case that
// crosses an origin, and it calls safeNext on the path itself. The rule this file enforces is
// "every read is validated where it is read", not "every read calls one particular function",
// so a second validator is learned rather than excused. Anything NOT in this list is still a
// raw read and still fails.
const NAMES_THE_GUARD = /safeNext\(|withNext\(|safeReturnUrl\(/;

/**
 * Lines that read the `next` parameter without naming safeNext or withNext.
 *
 * The rule is per LINE, which is coarse on purpose: a value validated three lines later was
 * unvalidated for three lines. The one call site that used to hand the raw parameter to a
 * callee that validates it (the kitchen's sign-up page, which passed it to `signUp`) now
 * validates it where it is read, like its four siblings, so there is one shape and no
 * exception to argue about. Comments count too: a line describing the read either names the
 * guard or gets reworded, which is cheaper than a parser.
 */
export function rawNextReads(files: SourceFile[]): string[] {
  const bad: string[] = [];
  for (const { path, text } of files) {
    text.split("\n").forEach((line, i) => {
      // Both spellings reach the same value: useSearchParams gives `params.get`, and the
      // callback route, being the landing point of a FULL page load, has to read
      // `new URLSearchParams(window.location.search)`.
      if (!READS_NEXT.test(line)) return;
      if (NAMES_THE_GUARD.test(line)) return;
      bad.push(`${path}:${i + 1}`);
    });
  }
  return bad;
}

const nextPathItself = (f: SourceFile) => f.path.endsWith("/nextPath.ts");

describe("the next parameter", () => {
  it("is never read without safeNext", () => {
    expect(rawNextReads(sources.filter((f) => !nextPathItself(f)))).toEqual([]);
  });

  it("is actually being looked for, so an empty result means clean and not unscanned", () => {
    // The guard above passes trivially if the glob stops matching, or if the regex stops
    // matching the way the code is written. These are the fixtures that fail when it does.
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.filter((f) => READS_NEXT.test(f.text)).length).toBeGreaterThanOrEqual(6);
  });

  it("flags a call site that navigates straight to what the URL said", () => {
    expect(
      rawNextReads([
        { path: "src/pages/Invented.tsx", text: 'navigate(params.get("next") ?? "/");' },
      ]),
    ).toEqual(["src/pages/Invented.tsx:1"]);
  });

  it("accepts the two shapes the real call sites use", () => {
    expect(
      rawNextReads([
        { path: "a.tsx", text: 'const next = safeNext(params.get("next"));' },
        { path: "b.tsx", text: '<Link to={withNext("/signin", params.get("next"))} />' },
      ]),
    ).toEqual([]);
  });
});
