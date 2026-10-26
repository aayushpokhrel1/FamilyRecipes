import { ADMIN_ORIGIN, FAMILY_ORIGIN, KITCHEN_ORIGIN } from "./hosts";
// Where to send someone once they are signed in.
//
// This used to ride in React Router's `state`, which lives in memory and dies the moment the
// browser leaves the page. THREE of the four ways into this app leave the page: Google
// redirects through accounts.google.com, and an email confirmation link is opened later, often
// in another tab. Only a password sign-in in the same tab survived, so an invite link sent to
// someone with no account, which is the case the whole feature exists for, dropped them on the
// home page with a kitchen of their own and no family. Found on production, 2026-10-10.
//
// A query parameter survives all of it, because it is part of the URL the round trip carries.

// A destination is only ever a path INSIDE this app, and this is the only thing that enforces
// it. The parameter arrives from a URL, so it is attacker-controlled: without this guard,
// `?next=https://evil.example/login` turns our own sign-in page into a redirector that lands a
// freshly authenticated person on someone else's copy of it.
//
// Hence: one leading slash, and nothing that a browser would read as a host. `//evil.example`
// and `/\evil.example` are both protocol-relative URLs, not paths.
// Our own three origins, and nothing else, ever. Built from the same constants the cross-app
// links use, so a host rename cannot leave this list pointing at a name we no longer own, which
// would be a redirect to whatever the registrar parks there.
const ALLOWED_RETURN_ORIGINS = [FAMILY_ORIGIN, KITCHEN_ORIGIN, ADMIN_ORIGIN];

export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  // A control character can smuggle a newline into a Location header downstream, and no
  // legitimate route in this app contains one.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}

/**
 * A destination on ANOTHER of our own hosts, which `safeNext` deliberately refuses.
 *
 * `safeNext` allows paths and nothing else, and that stays true: it is what stops
 * `?next=https://evil.example/login` turning the sign-in page into an open redirector, and it
 * must not learn to accept absolute URLs. This is a SEPARATE, DELIBERATELY NARROWER function
 * for the one case that genuinely crosses an origin: a signed-out visitor arriving at the
 * console, who has to sign in on the family app and come back.
 *
 * THE ALLOWLIST IS EXACT ORIGINS, never a suffix. `https://admin.enamelvault.com.evil.example`
 * ends with nothing useful but `startsWith`/`endsWith` checks on hostnames are exactly how this
 * class of bug ships, which is why `isAdminHost` in the Worker is written the same way. An
 * origin comparison on a parsed URL cannot be fooled by a prefix or a suffix.
 *
 * The PATH is still validated by safeNext, so everything that function refuses is still
 * refused: a protocol-relative path, a control character, anything not starting with a slash.
 */
export function safeReturnUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // Not an absolute URL at all. This function is only for cross-origin returns; a plain path
    // belongs to safeNext, and silently accepting one here would give two functions that both
    // half-handle the same input.
    return null;
  }
  if (!ALLOWED_RETURN_ORIGINS.includes(parsed.origin)) return null;
  // The path gets the same treatment it would get anywhere else.
  const path = safeNext(parsed.pathname + parsed.search);
  if (!path) return null;
  return `${parsed.origin}${path}`;
}

// Adds ?next= to an auth URL, and leaves it alone when there is nowhere in particular to go,
// so the common case stays a bare /signin.
export function withNext(base: string, next: string | null | undefined): string {
  const safe = safeNext(next);
  return safe ? `${base}?next=${encodeURIComponent(safe)}` : base;
}

// WHICH MARKETING PAGE SENT THEM, and the three values are the whole vocabulary. The
// parameter arrives from a URL exactly as `next` does, so it is attacker-controlled, and an
// unvalidated version of it is a free-text field a stranger writes into our database. The
// allowlist is also the column's check constraint in 0060 and the allowlist in
// credit_signup_source(): three copies of three words, because the client, the function and
// the column each have to refuse a fourth value on their own.
const SOURCES = ["hub", "family", "professional"];

export function safeFrom(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return SOURCES.includes(raw) ? raw : null;
}

// THE WHOLE REASON `from` NEEDS NO THREADING THROUGH THE AUTH MODULE.
//
// `next` is already the one value that survives every way into this app: Google redirects
// through accounts.google.com, and an email confirmation is opened later in another tab, and
// nextPath exists because router state survives neither. `from` has to travel the same road,
// so rather than adding a second parameter to signUp(), signInWithGoogle(), emailRedirectTo
// and the OAuth redirectTo, it is folded INTO the destination before any of them see it.
//
// So the three surfaces that read `?next=` wrap their ALREADY VALIDATED values in this, and
// everything downstream carries it for free. The landing page then finds `?from=` in its own
// URL, which is where AppLayout credits it.
//
// The call sites pass safeNext(...) and safeFrom(...) rather than the raw parameters, even
// though this function validates both again. That is deliberate and nextPath.callsites.test.ts
// enforces half of it: the one call site that used to hand a raw `next` to a callee that
// validated it was changed so that every read validates where it is read, giving one shape and
// no exception to argue about. Revalidating here is idempotent and costs nothing.
export function nextWithFrom(
  next: string | null | undefined,
  from: string | null | undefined,
): string | null {
  const safe = safeNext(next);
  const source = safeFrom(from);
  if (!source) return safe;
  // With nowhere in particular to go, the destination IS the home page, because the parameter
  // has to land somewhere for AppLayout to read it.
  const base = safe ?? "/";
  // A `next` can legitimately already carry a query string, such as an invite link, so the
  // separator is whichever one that leaves valid.
  return `${base}${base.includes("?") ? "&" : "?"}from=${source}`;
}
