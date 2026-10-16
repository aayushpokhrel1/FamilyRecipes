import { supabase } from "../supabaseClient";

// Which parts of the app are worth counting. Coarse on purpose: the question this table
// answers is "which features do families actually use", and a per-recipe or per-id row would
// answer a different, much more sensitive one.
export const SURFACES = [
  "recipes", "families", "potluck", "kitchen", "cupboard",
  "cookmode", "drafts", "settings", "profile", "moderation",
] as const;

export type Surface = (typeof SURFACES)[number];

// Pathnames that are not a surface: the sign-in and sign-up pages, the auth callback, the
// public documents, an invitation, a password reset, and anything unknown. Recording those
// would say nothing about which feature is used, and /join/:code carries an invite code.
//
// Pure, with no side effects, so it can be called (and tested) on its own.
export function surfaceFor(pathname: string): Surface | null {
  // Leading and trailing slashes must not change the answer, so /potluck, potluck and
  // /potluck/ all reduce to the same segments.
  const segments = pathname.split("/").filter((s) => s !== "");
  // No segments is the INDEX route, "/", which renders RecipeList, so it is "recipes" and
  // not null. The empty string reduces here too and gets the same answer; react-router never
  // produces it, since a pathname is always at least "/", so there is nothing to distinguish.
  if (segments.length === 0) return "recipes";

  switch (segments[0]) {
    case "recipes":
      // Cook mode is the feature being measured, so it is its own surface rather than a
      // second visit to "recipes". Checked before the generic recipes case.
      return segments[2] === "cook" ? "cookmode" : "recipes";
    case "families":
      return "families";
    case "potluck":
      return "potluck";
    case "kitchen":
      // More specific than /kitchen/:id, so it is checked first: the cupboard is a different
      // feature from a meal plan, and a plan id is never the literal "cupboard".
      return segments[1] === "cupboard" ? "cupboard" : "kitchen";
    case "drafts":
      return "drafts";
    case "settings":
      return "settings";
    // /me redirects to /cooks/<handle>, so both are the same surface.
    case "me":
    case "cooks":
      return "profile";
    case "moderation":
      return "moderation";
    default:
      return null;
  }
}

// The keys already sent in THIS tab, as `${day}|${surface}`. In memory only, and deliberately
// not localStorage, sessionStorage or a cookie: a stored key would be a non-essential
// identifier on the visitor's device, which makes a consent banner legally mandatory and
// would fail src/lib/browserStorage.test.ts. A reload losing the set costs at most one
// duplicate row, which the upsert below discards anyway.
const sent = new Set<string>();

// Fire-and-forget, like reportError: measuring usage must never be able to take down the app
// it is measuring. Nothing here is awaited and nothing is thrown.
export function recordVisit(pathname: string): void {
  const surface = surfaceFor(pathname);
  if (surface === null) return;

  try {
    // The LOCAL date, built from the local getters. NOT toISOString(): that converts to UTC,
    // so local midnight in any UTC+ timezone would report the previous day, and the table's
    // check constraint only accepts yesterday, today and tomorrow.
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Added BEFORE the write, so a second call in the same tick cannot slip past the check.
    const key = `${day}|${surface}`;
    if (sent.has(key)) return;
    sent.add(key);

    // AN RPC, NOT A CLIENT UPSERT, and 0060 has the long version. In short: `on conflict` needs
    // a select policy, because Postgres has to look at the conflicting row to decide whether
    // there is one, and this table deliberately has no select policy at all. So the upsert and
    // "nobody can read it" cannot both be had from here, and the unreadability is the half
    // worth keeping.
    //
    // The function takes no user id. It reads the cook from auth.uid(), so this call cannot
    // attribute a visit to anybody, which is stronger than being refused when it tries.
    supabase.rpc("record_visit", { p_day: day, p_surface: surface })
      // A rejected promise is NOT caught by the surrounding try/catch, because nothing here
      // awaits it. This handler is the only thing standing between a failed write and an
      // unhandled rejection in the console.
      .then(undefined, () => {});
  } catch {
    // Swallowed on purpose: recording a visit must never be a way to raise an error.
  }
}

// Credits the marketing page that produced this account, once.
//
// Everything that makes the number honest is in credit_signup_source() in 0060, not here:
// the account must be minutes old and the column must still be empty, and `now()` there is
// the only clock the caller cannot move. This call is just the messenger, so it is as
// forgiving as recordVisit: a failed credit must never be the thing that breaks a landing.
export function creditSignupSource(from: string): void {
  try {
    supabase.rpc("credit_signup_source", { p_source: from }).then(undefined, () => {});
  } catch {
    // Swallowed on purpose, for the same reason as recordVisit above.
  }
}
