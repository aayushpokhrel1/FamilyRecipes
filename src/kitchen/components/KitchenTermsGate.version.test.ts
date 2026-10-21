import { expect, it } from "vitest";
import { fingerprint, prose, sourceText } from "../../lib/termsFingerprint";

// The kitchen's half of the rule the family side already holds. Edit the wording of
// pages/Terms.tsx without bumping KITCHEN_TERMS_VERSION and two things happen: nobody is ever
// re-asked, and the stored row claims a person agreed to text they never saw. The second is
// the problem, because that row is the only evidence consent was given.
//
// WHEN THIS FAILS: bump KITCHEN_TERMS_VERSION in KitchenTermsGate.tsx, bump
// KITCHEN_TERMS_UPDATED in lib/legal.ts, and paste the hash the failure prints into EXPECTED.
// Deliberately slightly annoying: a terms change re-prompts every existing user, so it should
// cost a moment's thought.
//
// Note the FULL paths passed to sourceText. Both apps have a pages/Terms.tsx, and a bare
// suffix now throws rather than quietly guarding whichever file the glob sorted first.
const EXPECTED = "c49afd50";

it("re-prompts every kitchen user when the wording changes", () => {
  const actual = fingerprint(prose(sourceText("src/kitchen/pages/Terms.tsx")));
  expect(
    actual,
    `The kitchen terms changed. Bump KITCHEN_TERMS_VERSION in KitchenTermsGate.tsx and ` +
      `KITCHEN_TERMS_UPDATED in lib/legal.ts, then set EXPECTED in this test to "${actual}".`,
  ).toBe(EXPECTED);
});

it("keeps the kitchen version and the date on the page in step", () => {
  const version = /KITCHEN_TERMS_VERSION = "([^"]+)"/.exec(
    sourceText("src/kitchen/components/KitchenTermsGate.tsx"),
  )?.[1];
  const updated = /KITCHEN_TERMS_UPDATED = "([^"]+)"/.exec(sourceText("src/lib/legal.ts"))?.[1];
  expect(version, "the version must be an ISO date, so it sorts and is comparable").toMatch(
    /^\d{4}-\d{2}-\d{2}$/,
  );
  // The gate's version and the date the reader sees must describe the same day, or the page
  // says one thing while the stored acceptance records another.
  const [y, m, d] = (version ?? "").split("-");
  const month = new Date(`${y}-${m}-02`).toLocaleString("en-GB", { month: "long" });
  expect(updated).toBe(`${Number(d)} ${month} ${y}`);
});

it("does not let the two apps' versions drift into each other", () => {
  // They are separate on purpose: a kitchen clause must not re-prompt every family cook, and a
  // family clause must not re-prompt a restaurant group. The failure this catches is somebody
  // "tidying up" by pointing the kitchen gate at the family constant.
  const gate = sourceText("src/kitchen/components/KitchenTermsGate.tsx");
  expect(gate).not.toContain('from "../../components/TermsGate"');
  expect(gate).toContain("KITCHEN_TERMS_VERSION");
});

it("still carries the clauses this product's behaviour depends on", () => {
  // Not a style check. Each is load-bearing, and a later tidy-up that shortens this page must
  // not quietly drop one.
  //
  // The sign-off clause is the one THIS product specifically needs, the counterpart of the
  // family page's allergen warning: the app records that a named person approved a version,
  // and a reader could reasonably mistake that for a safety check that something here
  // performed. Nothing here performs one.
  //
  // prose() collapses whitespace, which MATTERS here rather than being tidiness. JSX wraps a
  // sentence across source lines, so the warranty disclaimer sits with a line break in the
  // middle of it and a flat regex against the raw source cannot see it. This test went red for
  // exactly that reason on its first run, with the clause present on the page. A guard that a
  // re-wrap can turn red is a guard people learn to ignore.
  const terms = prose(sourceText("src/kitchen/pages/Terms.tsx"));
  const missing = (
    [
      ["a sign-off is a record, not a certification", /not a certification/i],
      ["the app checks no allergens and verifies no yield", /does not check allergens/i],
      ["nothing here discharges a food safety duty", /HACCP/],
      ["do not make this the only copy of a required record", /only copy of a record/i],
      ["the content belongs to the business", /belongs to the business/i],
      ["you are here on your employer's behalf", /on your employer's behalf/i],
      ["publishing cannot be fully undone", /copies already saved/i],
      ["the records name who approved what", /who signed a version off/i],
      ["a minimum age of 18", /at least 18/i],
      ["the warranty disclaimer", /warranties that can be disclaimed are disclaimed/i],
      ["a liability cap", /limited to one hundred US dollars/i],
      ["governing law", /State of Ohio/i],
    ] as Array<[string, RegExp]>
  )
    .filter(([, pattern]) => !pattern.test(terms))
    .map(([name]) => name);
  expect(missing).toEqual([]);
});
