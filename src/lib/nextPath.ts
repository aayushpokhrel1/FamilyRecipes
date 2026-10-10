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
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  // A control character can smuggle a newline into a Location header downstream, and no
  // legitimate route in this app contains one.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}

// Adds ?next= to an auth URL, and leaves it alone when there is nowhere in particular to go,
// so the common case stays a bare /signin.
export function withNext(base: string, next: string | null | undefined): string {
  const safe = safeNext(next);
  return safe ? `${base}?next=${encodeURIComponent(safe)}` : base;
}
