// The moderation console's host. Pure helpers only: worker/index.ts does the I/O, for the same
// reason worker/site.ts and worker/kitchen.ts are shaped this way. HTMLRewriter and ASSETS have
// no implementation under Vitest, so everything that could be wrong lives here where a test can
// reach it.
//
// THE THIRD HOST. The apex is the landing page, recipes. is the family app, kitchen. is the
// professional-kitchen app, and this is the console. It exists because moderation should not
// require opening a product to do a job that is about neither product.
// Design: docs/superpowers/specs/2026-10-26-admin-console-host-design.md.
export const ADMIN_HOST = "admin.enamelvault.com";
export const ADMIN_ORIGIN = `https://${ADMIN_HOST}`;

// The built entry. Fetched INTERNALLY and refused as a public path, exactly as site.html and
// kitchen.html are, so the filename never appears in a URL anybody sees.
export const ADMIN_ENTRY = "/admin.html";

// Exact match, not endsWith: admin.enamelvault.com.evil.example would pass that, and anything
// downstream that trusts this host would then be trusting an attacker's. The same rule
// isSiteHost and isKitchenHost are written to, and it is written out here rather than shared
// because three one-line functions are cheaper to read than one clever one.
export function isAdminHost(hostname: string): boolean {
  return hostname.toLowerCase() === ADMIN_HOST;
}

// Disallow everything, and for a stronger reason than the kitchen host has.
//
// The kitchen host disallows crawling because everything behind it needs a session, so the only
// thing a crawler can reach is a sign-in form. That is true here too, and on top of it this host
// is a moderation console: its existence is not a secret, but nothing about it belongs in a
// search index, and the console answers "Not found" to a signed-in non-moderator precisely so it
// does not confirm itself. An indexed URL would undo that for free.
//
// There is no sitemap on this host and there must never be one.
export function adminRobots(): string {
  return [
    "# The moderation console. Every page needs a moderator session, so there is nothing",
    "# here a crawler can reach, and nothing here that should be indexed if there were.",
    "User-agent: *",
    "Disallow: /",
    "",
  ].join("\n");
}
