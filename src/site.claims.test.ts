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
import siteHtml from "../public/site.html?raw";
import kitchenTerms from "./kitchen/pages/Terms.tsx?raw";

/**
 * Capabilities the kitchen terms explicitly deny, as nouns a marketing page would reach for.
 * Each must appear in that disclaimer, so this list cannot quietly outlive it.
 */
// "cost" rather than "portion cost": the copy that shipped said "costs", which the longer
// phrase did not match, so the guard went green on the exact sentence it existed to catch.
// A claim word is what a marketing page actually writes, not the careful phrase the terms use.
const DISCLAIMED = ["allergen", "yield", "cost"];

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

  for (const word of DISCLAIMED) {
    it(`does not advertise ${word}`, () => {
      expect(
        prose(siteHtml).includes(word),
        `site.html advertises "${word}", which src/kitchen/pages/Terms.tsx says the app does not do`,
      ).toBe(false);
    });
  }
});
