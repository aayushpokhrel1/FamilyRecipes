// Fails if an auth card loses its way off the page, or wears the wrong product's name.
//
// The auth pages are the ONLY ones outside their app's layout, so they carry no header: a
// visitor who arrives at one from a shared recipe link, which is the common way to arrive,
// has nothing to click that explains the product or leads anywhere. SignIn had that fixed
// first; the other three had the same dead end and were caught by reading them.
//
// BOTH APPS ARE LISTED HERE, and that is not tidiness. This file used to read the family's
// four pages only. The kitchen app then reused AuthMark, which hard-coded "Family Recipes",
// and a chef signing in to the professional product was greeted by the family product's
// name, with the whole suite green. This repo has the same lesson written down about
// routes.terms.test.ts: a guard covering one of two apps reports success for the app it
// cannot see.
//
// Source-reading rather than behavioural, in the same spirit as routes.terms.test.ts: the
// thing that can regress is the WIRING, a card rendered without the mark, and each of these
// pages has two or three cards that a rendering test would have to drive into one at a time.
// SignIn.test.tsx pins the href itself, so the link's destination is covered behaviourally.
import { describe, expect, it } from "vitest";
import signIn from "../pages/SignIn.tsx?raw";
import signUp from "../pages/SignUp.tsx?raw";
import recover from "../pages/Recover.tsx?raw";
import callback from "../pages/AuthCallback.tsx?raw";
import kitchenSignIn from "../kitchen/pages/SignIn.tsx?raw";
import kitchenRecover from "../kitchen/pages/Recover.tsx?raw";
import kitchenSignUp from "../kitchen/pages/SignUp.tsx?raw";

const FAMILY_LABEL = "Family Recipes";
const KITCHEN_LABEL = "Enamel Vault for kitchens";

const PAGES: { name: string; source: string; label: string }[] = [
  { name: "SignIn", source: signIn, label: FAMILY_LABEL },
  { name: "SignUp", source: signUp, label: FAMILY_LABEL },
  { name: "Recover", source: recover, label: FAMILY_LABEL },
  { name: "AuthCallback", source: callback, label: FAMILY_LABEL },
  { name: "kitchen SignIn", source: kitchenSignIn, label: KITCHEN_LABEL },
  { name: "kitchen Recover", source: kitchenRecover, label: KITCHEN_LABEL },
  { name: "kitchen SignUp", source: kitchenSignUp, label: KITCHEN_LABEL },
];

describe("every auth card carries the mark", () => {
  for (const { name, source, label } of PAGES) {
    it(`${name} puts a mark on each of its cards`, () => {
      // One per `plate auth-card`: these pages switch between a form and a confirmation,
      // and the confirmation is exactly the card someone gets stuck on.
      const cards = source.match(/className="plate auth-card"/g)?.length ?? 0;
      expect(cards).toBeGreaterThan(0);
      // Any props, so adding one to AuthMark does not quietly stop this counting anything.
      // The old pattern was the literal self-closing tag and matched nothing the moment the
      // label prop arrived, which would have reported every page as having zero cards had
      // the count assertion above not been there.
      expect(source.match(/<AuthMark\b[^>]*\/>/g)?.length ?? 0).toBe(cards);
    });

    it(`${name} names its own product, not the other one`, () => {
      const labels = [...source.matchAll(/<AuthMark\b[^>]*\blabel="([^"]*)"/g)].map((m) => m[1]);
      expect(labels.length).toBeGreaterThan(0);
      for (const found of labels) {
        expect(found, `${name} carries the wrong product name`).toBe(label);
      }
    });
  }
});
