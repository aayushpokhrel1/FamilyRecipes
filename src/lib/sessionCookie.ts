// Where the Supabase session lives, so that one sign-in covers all three apps.
//
// Until 2026-10-26 the session sat in localStorage, which is per-ORIGIN: signing in on
// recipes.enamelvault.com left kitchen.enamelvault.com and admin.enamelvault.com signed out,
// and a third host made that worse. A cookie scoped to `.enamelvault.com` is sent to all of
// them, so the session follows you.
//
// THE TRADE, STATED ONCE AND ON PURPOSE. This cookie CANNOT be HttpOnly, because supabase-js
// reads the session from JavaScript. Under localStorage an XSS on the kitchen host could not
// reach the family session; now one XSS on any *.enamelvault.com host yields a session valid on
// all of them, including the moderation console, whose whole job is privileged.
//
// What makes that acceptable rather than reckless is the Content-Security-Policy the Worker
// sends on every response, which is pinned by worker/meta.test.ts. That header is no longer
// defence in depth. It is the control this design leans on, so weakening it, or serving any of
// these hosts without it, is what turns this file from a convenience into a hole.
//
// BE PRECISE ABOUT WHAT IT ACTUALLY SAYS, because the comfortable version of this sentence is
// wrong. The policy is `script-src 'self' https://static.cloudflareinsights.com`, NOT `'self'`
// alone: no INLINE script can run, which is the attack this mostly closes, but one third-party
// origin is trusted to serve script to every one of these hosts. That origin is Cloudflare's
// analytics beacon, measured on the live response 2026-10-26. It is a small and deliberate
// hole rather than no hole, and anyone widening script-src further is spending the budget this
// file already borrowed against.
//
// Design: docs/superpowers/specs/2026-10-26-admin-console-host-design.md.

// Chrome refuses a cookie larger than about 4096 bytes INCLUDING its name and attributes, and
// it refuses it SILENTLY: the write simply does not happen. A Supabase session holding an
// access token, a refresh token and the user object routinely exceeds that, so a single-cookie
// implementation works in development against a small user row and then fails in production
// against a real one, presenting as a random sign-out rather than as an error.
//
// 3180 leaves room for the name, the attributes and the base64 expansion. The same figure
// @supabase/ssr uses, for the same reason.
const CHUNK_SIZE = 3180;

// NO DOMAIN AT ALL IN DEV, AND THIS IS MEASURED RATHER THAN REASONED. The first version of
// this file wrote `Domain=localhost`, on the belief that it would then be sent to
// admin.localhost and kitchen.localhost and make the three-host hop walkable locally. Chrome
// REFUSES that cookie, silently, exactly as it refuses an oversized one: setting
// `probe=a; Domain=localhost` and reading document.cookie back in the browser on
// admin.localhost:5174 returns nothing. `Domain=.localhost` is refused too.
//
// So for one day every dev sign-in was in memory only: supabase-js wrote the session, the
// write vanished, and the next read found no session. It presented as the console answering
// "Not found" to an account whose is_moderator was true, because RequireModerator's profile
// read asked for a user that storage could no longer produce. Found by walking the console in
// a browser, 2026-10-26, with the unit suite green: jsdom's cookie jar accepts `Domain` values
// a real browser rejects, so no test here could have seen it.
//
// Omitting Domain gives a HOST-ONLY cookie, which persists correctly on each dev host and does
// not cross between them. That is the same isolation localStorage had, so the cost is that the
// one-sign-in-covers-three-hosts behaviour is a PRODUCTION behaviour and has to be walked
// there. `Secure` is omitted in dev for the same kind of reason: dev is plain http.
const DEV = import.meta.env.DEV;

// A function taking `dev` rather than a constant, so a test can state what PRODUCTION does.
// import.meta.env.DEV is true under Vitest, so a test reading the constant would only ever
// assert the dev value against itself: the same trap src/lib/hosts.ts names in its own header.
export function cookieDomain(dev: boolean): string | null {
  return dev ? null : ".enamelvault.com";
}

const DOMAIN = cookieDomain(DEV);

// SameSite=Lax, NOT Strict, and this is load-bearing. The OAuth round trip returns from
// accounts.google.com, which is a cross-site navigation: under Strict the cookie would not be
// sent on that arrival and the session would appear to vanish at exactly the moment it was
// created. Lax sends it on a top-level navigation, which is what a redirect back is.
function attributes(maxAgeSeconds: number): string {
  const parts = ["Path=/", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  // A cookie written WITH a Domain and erased without one is a different cookie to the
  // browser, and the original survives, so both forms are built here and nowhere else.
  if (DOMAIN) parts.unshift(`Domain=${DOMAIN}`);
  if (!DEV) parts.push("Secure");
  return parts.join("; ");
}

// A year. The refresh token is what actually governs how long a session lives; this only has to
// outlast it, because a cookie that expires first would log someone out while their session was
// still perfectly valid.
const A_YEAR = 60 * 60 * 24 * 365;

function readAll(): Map<string, string> {
  const out = new Map<string, string>();
  // document.cookie is a single string of "a=1; b=2". An empty one splits to [""], hence the
  // guard: without it every page load would record a bogus "" key.
  if (!document.cookie) return out;
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out.set(name, value);
  }
  return out;
}

function write(name: string, value: string): void {
  document.cookie = `${name}=${value}; ${attributes(A_YEAR)}`;
}

function erase(name: string): void {
  // Max-Age=0 with the SAME Domain and Path, or the browser treats it as a different cookie and
  // the original survives. A sign-out that leaves the session cookie in place is the worst
  // possible outcome of this file, so the attributes are built by the same function.
  document.cookie = `${name}=; ${attributes(0)}`;
}

/**
 * A storage adapter in the shape supabase-js expects, backed by cookies and chunked.
 *
 * Chunking scheme: a value that fits is written to `key`. One that does not is written to
 * `key.0`, `key.1`, ... and `key` itself is NOT written. Reading tries the plain key first and
 * then walks the numbered ones.
 *
 * REMOVING ALWAYS CLEARS BOTH FORMS, and clears more chunks than it wrote. A session that
 * shrinks (a smaller user object, a shorter token) would otherwise leave `key.3` behind from a
 * previous larger one, and the next read would reassemble a corrupt value out of new chunks
 * plus one stale tail.
 */
export const cookieStorage = {
  getItem(key: string): string | null {
    const jar = readAll();
    const single = jar.get(key);
    if (single !== undefined) return decodeURIComponent(single);

    const parts: string[] = [];
    for (let i = 0; ; i++) {
      const part = jar.get(`${key}.${i}`);
      if (part === undefined) break;
      parts.push(part);
    }
    if (parts.length === 0) return null;
    return decodeURIComponent(parts.join(""));
  },

  setItem(key: string, value: string): void {
    // Encoded, because a session is JSON and a raw `;` or `,` in it would terminate the cookie
    // early and silently truncate the value.
    const encoded = encodeURIComponent(value);

    // Clear whatever shape was there before switching shapes, or a previous single value sits
    // next to the new chunks and getItem returns it in preference.
    this.removeItem(key);

    if (encoded.length <= CHUNK_SIZE) {
      write(key, encoded);
      return;
    }
    for (let i = 0; i * CHUNK_SIZE < encoded.length; i++) {
      write(`${key}.${i}`, encoded.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
  },

  removeItem(key: string): void {
    erase(key);
    const jar = readAll();
    for (const name of jar.keys()) {
      // Every numbered chunk of this key, however many there are, rather than counting down
      // from what we think we wrote.
      if (name.startsWith(`${key}.`)) erase(name);
    }
  },
};
