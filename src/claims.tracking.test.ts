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

// NEITHER APP MAY CLAIM "NO COOKIES" EITHER, AND THIS IS THE SECOND HALF OF THE SAME LESSON.
//
// On 2026-10-26 the session moved out of localStorage into a cookie on `.enamelvault.com`, so
// that one sign-in covers all three apps. That made "no cookies" false everywhere it was
// written, and the design said in advance that every such claim had to move in the SAME commit
// or not at all. Seven were corrected. These two were not, and they shipped to production:
//
//   - `src/components/SiteFooter.tsx`, which renders on EVERY page of the family app
//   - `src/kitchen/pages/Privacy.tsx`, the kitchen's privacy policy
//
// Both were missed for the same reason the metadata description was missed a day earlier: the
// guards that existed read the three MARKETING pages (`worker/meta.test.ts`,
// `src/site.claims.test.ts`), and neither could see a file in `src/`. A set of guards is not
// coverage; the union of what they read is. This one reads every source file, like the tracking
// rule above it, so there is no directory left for the next one to hide in.
//
// WHAT IS STILL ALLOWED, because each names a KIND of cookie that genuinely is absent:
// "no advertising cookies", "no analytics cookies", "no third-party tracking cookies". The
// rule is only against the unqualified denial, which is now simply untrue.
const NO_COOKIES_CLAIM = /\bno cookies\b|\bsets no cookies\b|\bcookie[- ]free\b/i;

it("anchors on the cookies page still saying the app sets one", () => {
  // If that page ever goes back to denying cookies, this rule is enforcing the wrong thing and
  // should fail rather than quietly guard a claim nobody makes any more.
  // Paths here are relative to this file, so match the tail and exclude the kitchen app,
  // which has no cookies page of its own.
  const cookiesPage = pages.find(
    (f) => f.path.endsWith("pages/Cookies.tsx") && !f.path.includes("kitchen"),
  );
  expect(cookiesPage, "src/pages/Cookies.tsx is no longer being read").toBeDefined();
  expect(prose(cookiesPage!.text)).toContain("sets one cookie");
});

it("makes no blanket claim that either app sets no cookies", () => {
  const offenders = pages
    .filter((f) => NO_COOKIES_CLAIM.test(prose(f.text)))
    .map((f) => f.path);
  expect(
    offenders,
    "these say the app sets no cookies, which stopped being true when the session moved into one",
  ).toEqual([]);
});

it("still allows naming a kind of cookie that really is absent", () => {
  expect(NO_COOKIES_CLAIM.test("no advertising cookies, no analytics cookies")).toBe(false);
  expect(NO_COOKIES_CLAIM.test("no third-party tracking cookies")).toBe(false);
  // And catches both wordings that actually shipped.
  expect(NO_COOKIES_CLAIM.test("Free to use, no adverts, no cookies.")).toBe(true);
  expect(NO_COOKIES_CLAIM.test("no third-party tracking pixels and no cookies.")).toBe(true);
  expect(NO_COOKIES_CLAIM.test("This app sets no cookies")).toBe(true);
});
