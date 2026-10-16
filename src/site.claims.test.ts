// THE LANDING PAGE MUST NOT SELL WHAT THE KITCHEN TERMS DISCLAIM.
//
// This exists because it already happened. On 2026-10-15 the landing page was changed to
// offer the professional-kitchen app, and the paragraph that had described the intended
// product kept its wording while losing the sentence that said it did not exist yet. The
// result advertised "costs, yields and a record of who changed what" about an app a stranger
// could sign into, while src/kitchen/pages/Terms.tsx told that same stranger, in bold, that
// the app "does not check allergens, does not verify a yield, does not calculate a portion
// cost". Both pages are public. Only one of them can be true.
//
// Nobody re-reads the terms before editing marketing copy, which is the whole reason the two
// drifted, so the terms are treated here as the authoritative statement of what the product
// does NOT do, and the landing page is checked against it.
//
// WHEN THIS FAILS you have two honest options and one dishonest one. Either stop claiming the
// thing on the landing page, or build it and soften the disclaimer in the kitchen terms.
// Deleting a word from the list below so the test goes quiet is the dishonest one.
import { describe, expect, it } from "vitest";
import familyHtml from "../public/family.html?raw";
import professionalHtml from "../public/professional.html?raw";
import siteHtml from "../public/site.html?raw";
import readme from "../README.md?raw";
import cookies from "./pages/Cookies.tsx?raw";
import kitchenTerms from "./kitchen/pages/Terms.tsx?raw";

/**
 * Capabilities the kitchen terms explicitly deny, as nouns a marketing page would reach for.
 * Each must appear in that disclaimer, so this list cannot quietly outlive it.
 */
// "cost" rather than "portion cost": the copy that shipped said "costs", which the longer
// phrase did not match, so the guard went green on the exact sentence it existed to catch.
// A claim word is what a marketing page actually writes, not the careful phrase the terms use.
// Widened on 2026-10-15 when enamelvault.com/professional was added. The terms disclaim
// temperature and shelf life in the same breath as the first three, and a page written to
// sell the kitchen app is far likelier to reach for them than the family homepage was.
const DISCLAIMED = ["allergen", "yield", "cost", "temperature", "shelf life"];

// BOTH marketing pages, not just the homepage. The one that actually sells the kitchen app
// is the one most likely to over-claim, and a guard that reads only the other page reports
// success for the page it cannot see.
const PAGES = [
  ["site.html", siteHtml],
  ["family.html", familyHtml],
  ["professional.html", professionalHtml],
] as const;

function prose(html: string): string {
  // Comments hold reasoning for developers and are not claims made to a reader.
  return html.replace(/<!--[\s\S]*?-->/g, "").toLowerCase();
}

describe("the landing page does not promise what the kitchen terms refuse", () => {
  it("still has the disclaimer this test is anchored to", () => {
    const terms = kitchenTerms.toLowerCase();
    expect(
      terms.includes("does not check allergens"),
      "the kitchen terms' specific disclaimer has moved, so this test is checking nothing",
    ).toBe(true);
    for (const word of DISCLAIMED) {
      expect(terms, `the terms no longer mention ${word}`).toContain(word);
    }
  });

  for (const [name, html] of PAGES) {
    for (const word of DISCLAIMED) {
      it(`${name} does not advertise ${word}`, () => {
        expect(
          prose(html).includes(word),
          `${name} advertises "${word}", which src/kitchen/pages/Terms.tsx says the app does not do`,
        ).toBe(false);
      });
    }
  }
});

// THE MARKETING FOOTERS MUST NOT DENY THE ANALYTICS THE COOKIES PAGE DESCRIBES.
//
// All three footers said "sets no cookies and uses no analytics" until 2026-10-16, while
// src/pages/Cookies.tsx had a whole section headed "The one count we do keep" explaining that
// Cloudflare counts page views. Both are public. Only one could be true, and the footer was
// the wrong one: Cloudflare Web Analytics has been enabled at the zone since 2026-09-25.
//
// The cookies page is treated as authoritative here for the same reason the kitchen terms are
// above: it is the page written carefully, and the footer is the line nobody re-reads.
//
// "no cookies" is still allowed and still true. It is the ANALYTICS denial that is false.
describe("the marketing footers do not deny what the cookies page discloses", () => {
  it("still has the cookies page's disclosure this test is anchored to", () => {
    expect(
      cookies.toLowerCase().includes("counts page views"),
      "Cookies.tsx no longer describes the page count, so this test is checking nothing",
    ).toBe(true);
  });

  for (const [name, html] of PAGES) {
    it(`${name} does not claim there is no analytics`, () => {
      expect(
        /\bno analytics\b|\buses no analytics\b|\bwithout analytics\b/.test(prose(html)),
        `${name} denies analytics, which src/pages/Cookies.tsx says in public that we do run`,
      ).toBe(false);
    });
  }
});

// THE README DENIED THE ANALYTICS TOO, and nothing above could see it.
//
// Everything in this file reads the three marketing pages. The README said the app "loads no
// analytics, which a test enforces rather than a promise" until 2026-10-16, which was false
// twice over: Cloudflare Web Analytics has been on at the zone since 2026-09-25, and the app
// now keeps its own dated record of which sections a signed-in account opened. The sentence
// even invoked a test as its authority, while being in the one file that test did not read.
//
// That is the same shape as the bug recorded about the two routers and the two apps: a guard
// covering one of several places reports success for the places it cannot see. The README is
// a public document on a public repository, so it is held to the claim too.
it("the README does not deny the analytics the cookies page discloses", () => {
  const text = readme.toLowerCase();
  expect(
    /\bno analytics\b|\bloads no analytics\b|\bwithout analytics\b/.test(text),
    "README.md denies analytics, which src/pages/Cookies.tsx says in public that we do run",
  ).toBe(false);
});

it("is reading the real README, so an empty result means clean and not unscanned", () => {
  // The guard above passes trivially if the import ever resolves to nothing.
  expect(readme.length).toBeGreaterThan(2000);
  expect(readme).toContain("Moderator console");
});
