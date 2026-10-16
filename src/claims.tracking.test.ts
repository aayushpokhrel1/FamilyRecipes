import { expect, it } from "vitest";
import { sources } from "./lib/sourceFiles";

// NEITHER APP MAY CLAIM "NO TRACKING", AND THIS IS WHAT SAYS SO.
//
// Both footers said "no adverts, no tracking, no cookies" until 2026-10-16. On that day the
// family app started keeping a dated note of which parts of it an account opened, so that it
// could answer whether anyone comes back. Nothing is stored on the device, no consent banner
// is required, and /privacy and /cookies both describe the record in full. But "no tracking"
// is a blanket claim in a line nobody re-reads, and whether a per-account record of use counts
// as tracking is a reader's judgement, not ours to assume.
//
// THE KITCHEN APP IS HELD TO THE SAME RULE EVEN THOUGH ITS CLAIM WAS STILL TRUE. It records
// nothing: activity_days lives in the public schema and kitchen_seal.test.ts forbids the
// kitchen from importing the module that writes it. The claim was dropped there anyway,
// because two products from one operator whose footers disagree about a privacy claim is the
// kind of difference nobody notices until it misleads somebody, and because a kitchen that
// gains the same counting later would have to remember to come back here. It would not.
//
// WHAT IS STILL ALLOWED, because each says precisely what is absent rather than making a
// blanket promise:
//   - "no third-party tracking pixels": true, nothing is loaded from anyone else at all.
//   - "tracking cookies": /cookies explaining which kinds of cookie would need a banner.
// The rule is only against the unqualified claim.
const BLANKET_CLAIM = /\bno tracking\b(?!\s+pixels)|\bnot tracked\b|\bwe do not track\b/i;

// Prose only. A comment in a source file explaining the rule is not a claim made to anybody,
// and this test's own text would otherwise trip it.
function prose(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
    .join("\n");
}

const pages = sources.filter((f) => !f.path.includes("claims.tracking"));

it("is reading real sources, so an empty result means clean and not unscanned", () => {
  expect(pages.length).toBeGreaterThan(50);
  // The footers are the files this exists for; if they stop being found, so has the guard.
  expect(pages.some((f) => f.path.endsWith("SiteFooter.tsx"))).toBe(true);
  expect(pages.some((f) => f.path.endsWith("KitchenFooter.tsx"))).toBe(true);
});

it("makes no blanket claim that neither app tracks you", () => {
  const offenders = pages
    .filter((f) => BLANKET_CLAIM.test(prose(f.text)))
    .map((f) => f.path);
  expect(offenders).toEqual([]);
});

it("still allows the precise claims, which are true and are the point", () => {
  expect(BLANKET_CLAIM.test("no third-party tracking pixels")).toBe(false);
  expect(BLANKET_CLAIM.test("tracking cookies")).toBe(false);
  // And catches the wording that actually shipped, in both its forms.
  expect(BLANKET_CLAIM.test("Free to use, no adverts, no tracking, no cookies.")).toBe(true);
  expect(BLANKET_CLAIM.test("You are not tracked here.")).toBe(true);
  expect(BLANKET_CLAIM.test("We do not track you.")).toBe(true);
});
