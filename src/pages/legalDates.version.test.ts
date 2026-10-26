import { expect, it } from "vitest";
import { fingerprint, prose, sourceText } from "../lib/termsFingerprint";

// THE THREE LEGAL PAGES THAT HAVE A DATE AND NO GATE.
//
// Both terms pages are already guarded, because changing them has to re-prompt every user and
// `TermsGate.version.test.ts` fingerprints the prose against the stored version. Privacy and
// cookies have no gate: nobody is re-asked, the only thing that changes is the "Last updated"
// line the reader is shown. So the comment in `lib/legal.ts` saying "BUMP THE DATE WHEN YOU
// CHANGE THAT PAGE'S WORDING" was the whole mechanism, and this project has written down three
// times that a comment is the least reliable form of a rule: the failure mode is not ignorance,
// it is not re-reading.
//
// IT HAD ALREADY FAILED when this was written. `src/pages/Privacy.tsx` was edited on
// 2026-10-12 (commit f6aa383, the wording about recipes surviving deletion) and `lib/legal.ts`
// was last touched on 2026-10-11, so the privacy policy told every reader it was last updated
// the day BEFORE the day its wording changed. A policy that misstates its own revision date
// undermines the one thing a reader uses it for, which is knowing whether what they read last
// time still holds.
//
// WHEN THIS FAILS: bump that page's constant in `lib/legal.ts` to today, then paste the hash
// the failure message prints into the table below.
//
// Full repo paths, never suffixes. There are two `pages/Privacy.tsx` in this repo and the glob
// sorts the kitchen one first, so a suffix would quietly fingerprint the wrong document: it
// fails once, and pasting the printed hash in makes it green for ever while guarding nothing.
// `sourceText` throws on an ambiguous suffix for exactly that reason, and the last test here
// proves it still does.
const PAGES: { path: string; constant: string; hash: string }[] = [
  { path: "src/pages/Privacy.tsx", constant: "PRIVACY_UPDATED", hash: "fb19466e" },
  { path: "src/pages/Cookies.tsx", constant: "COOKIES_UPDATED", hash: "f5fd507c" },
  { path: "src/kitchen/pages/Privacy.tsx", constant: "KITCHEN_PRIVACY_UPDATED", hash: "2541da70" },
];

for (const page of PAGES) {
  it(`notices when ${page.path} changes without its date`, () => {
    const actual = fingerprint(prose(sourceText(page.path)));
    expect(
      actual,
      `${page.path} changed. Set ${page.constant} in src/lib/legal.ts to today's date, then set this page's hash to "${actual}".`,
    ).toBe(page.hash);
  });
}

it("states a real date for each of those pages", () => {
  // A hash pinned against a constant that has gone missing or become a placeholder would pass
  // while guarding nothing, so the shape of the date is checked too. "1 October 2026", the
  // format the pages render.
  const legal = sourceText("src/lib/legal.ts");
  for (const { constant } of PAGES) {
    const value = new RegExp(`${constant} = "([^"]+)"`).exec(legal)?.[1];
    expect(value, `${constant} is missing from src/lib/legal.ts`).toBeDefined();
    expect(value, `${constant} must read like "13 October 2026"`).toMatch(
      /^\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/,
    );
  }
});

it("refuses to guess which Privacy page is meant", () => {
  expect(() => sourceText("pages/Privacy.tsx")).toThrow(/matches 2 files/);
});
