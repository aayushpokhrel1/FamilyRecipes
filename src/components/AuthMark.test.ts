// Fails if an auth card loses its way off the page.
//
// The four auth pages are the ONLY ones outside AppLayout, so they carry no header: a
// visitor who arrives at one from a shared recipe link, which is the common way to arrive,
// has nothing to click that explains the product or leads anywhere. SignIn had that fixed
// first; the other three had the same dead end and were caught by reading them.
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

const PAGES = { SignIn: signIn, SignUp: signUp, Recover: recover, AuthCallback: callback };

describe("every auth card carries the mark", () => {
  for (const [name, source] of Object.entries(PAGES)) {
    it(`${name} puts a mark on each of its cards`, () => {
      // One per `plate auth-card`: these pages switch between a form and a confirmation,
      // and the confirmation is exactly the card someone gets stuck on.
      const cards = source.match(/className="plate auth-card"/g)?.length ?? 0;
      expect(cards).toBeGreaterThan(0);
      expect(source.match(/<AuthMark \/>/g)?.length ?? 0).toBe(cards);
    });
  }
});
