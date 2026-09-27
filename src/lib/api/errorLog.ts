import { supabase } from "../supabaseClient";

// A production failure used to be invisible until a person hit it and said so. This is the
// one place a failure gets recorded, so it has to be the one place that cannot fail loudly:
// a broken reporter must never take down the app it is reporting on.
const MAX_REPORTS = 20;
const MAX_MESSAGE = 2000;
const MAX_STACK = 4000;

let sent = 0;
// Set while a report is in flight. Without it, a throw from inside the reporting path (a
// broken client, a getter that throws) would be reported, and that report could fail the
// same way, forever.
let reporting = false;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function reportError(context: string, err: unknown): void {
  // A render loop can call this thousands of times a second; the cap is what stops that
  // from becoming thousands of rows and a saturated network.
  if (reporting || sent >= MAX_REPORTS) return;
  reporting = true;
  sent++;
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? null) : null;
    // Pathname only. On /recipes/:id a full href IS a recipe id, and a query string or hash
    // can carry anything the user was looking at.
    const url = typeof window !== "undefined" ? window.location.pathname : null;
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;

    // No user_id: the column defaults to auth.uid() and the RLS check requires the row to
    // match the caller, so sending it would only restate what the database already knows.
    supabase.from("error_log").insert({
      context,
      message: truncate(message, MAX_MESSAGE),
      stack: stack === null ? null : truncate(stack, MAX_STACK),
      url,
      user_agent: userAgent,
    })
      // A rejected promise is NOT caught by the surrounding try/catch, because nothing here
      // awaits it. This handler is the only thing standing between a failed insert and an
      // unhandled rejection in the console.
      .then(undefined, () => {});
  } catch {
    // Swallowed on purpose: reporting an error must never be a way to raise one.
  } finally {
    reporting = false;
  }
}
