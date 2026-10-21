import { supabase } from "../../supabaseClient";

// Which parts of the kitchen app are worth counting. Coarse on purpose: the question this
// table answers is "which parts of a group do kitchens actually use", and a per-dish or
// per-person row would answer a different, much more sensitive one.
export const KITCHEN_SURFACES = ["sites", "staff", "dishes", "numbers", "settings"] as const;

export type KitchenSurface = (typeof KITCHEN_SURFACES)[number];

// The surface a pathname inside a group belongs to, or null for everything else.
//
// Pure, with no side effects, so it can be called (and tested) on its own.
export function kitchenSurfaceFor(pathname: string): KitchenSurface | null {
  // Leading and trailing slashes must not change the answer, so /orgs/x/sites, orgs/x/sites
  // and /orgs/x/sites/ all reduce to the same segments.
  const segments = pathname.split("/").filter((s) => s !== "");
  // A group page is /orgs/:id/<surface>, so the surface is the segment AFTER the org id.
  // Anything shorter is outside a group: "/", /orgs/new, /terms, /privacy, /join/:code and
  // the auth pages. There is no org to key a row by there, so nothing is recorded.
  if (segments[0] !== "orgs" || segments.length < 3) return null;

  switch (segments[2]) {
    case "sites":
      return "sites";
    case "staff":
      return "staff";
    // A dish detail page is the dishes surface, not a surface of its own: the feature being
    // measured is the dish pipeline, and a per-dish row would answer a much more sensitive
    // question.
    case "dishes":
      return "dishes";
    case "numbers":
      return "numbers";
    case "settings":
      return "settings";
    default:
      return null;
  }
}

// The keys already sent in THIS tab, as `${orgId}|${day}|${surface}`. In memory only, and
// deliberately not localStorage, sessionStorage or a cookie: a stored key would be a
// non-essential identifier on the device, which makes a consent banner legally mandatory and
// would fail src/lib/browserStorage.test.ts. A reload losing the set costs at most one
// duplicate row, which the upsert in the database discards anyway.
const sent = new Set<string>();

// Fire-and-forget, like recordVisit in the family app: measuring usage must never be able to
// take down the app it is measuring. Nothing here is awaited and nothing is thrown.
export function recordKitchenVisit(orgId: string, pathname: string): void {
  const surface = kitchenSurfaceFor(pathname);
  if (surface === null) return;

  try {
    // The LOCAL date, built from the local getters. NOT toISOString(): that converts to UTC,
    // so local midnight in any UTC+ timezone would report the previous day, and the table's
    // check constraint only accepts yesterday, today and tomorrow.
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Added BEFORE the write, so a second call in the same tick cannot slip past the check.
    const key = `${orgId}|${day}|${surface}`;
    if (sent.has(key)) return;
    sent.add(key);

    // An RPC rather than a client upsert, for the reason 0060 gives about record_visit: an
    // `on conflict` needs a select policy, because Postgres has to look at the conflicting row
    // to decide whether there is one, and this table deliberately has no select policy at all.
    //
    // The function takes no user id. It reads the person from auth.uid(), so this call cannot
    // attribute a visit to anybody, which is stronger than being refused when it tries.
    supabase
      .schema("kitchen")
      .rpc("record_kitchen_visit", { p_org: orgId, p_day: day, p_surface: surface })
      // A rejected promise is NOT caught by the surrounding try/catch, because nothing here
      // awaits it. This handler is the only thing standing between a failed write and an
      // unhandled rejection in the console.
      .then(undefined, () => {});
  } catch {
    // Swallowed on purpose: recording a visit must never be a way to raise an error.
  }
}
