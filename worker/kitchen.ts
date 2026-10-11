// The professional-kitchen app's host. Pure helpers only: worker/index.ts does the I/O, for
// the same reason worker/site.ts is shaped this way. HTMLRewriter and ASSETS have no
// implementation under Vitest, so everything that could be wrong lives here where a test can
// reach it.
export const KITCHEN_HOST = "kitchen.enamelvault.com";
export const KITCHEN_ORIGIN = `https://${KITCHEN_HOST}`;

// The built entry. It is fetched INTERNALLY and refused as a public path, exactly as
// site.html is, so the filename never appears in a URL anybody sees.
export const KITCHEN_ENTRY = "/kitchen.html";

// Exact match, not endsWith: kitchen.enamelvault.com.evil.example would pass that, and
// anything downstream that trusts this host would then be trusting an attacker's.
export function isKitchenHost(hostname: string): boolean {
  return hostname.toLowerCase() === KITCHEN_HOST;
}

/**
 * Paths that are real files in dist/ and must be SERVED on this host rather than rewritten
 * to the app shell.
 *
 * This exists because `not_found_handling: "single-page-application"` in wrangler.jsonc
 * serves dist/index.html, the FAMILY app, for anything with no matching file. So the kitchen
 * host has to rewrite its own routes to its own entry, and if that rewrite caught the bundle
 * as well, the browser would be served HTML where it asked for javascript.
 *
 * An allowlist, anchored, and it must stay one. ADD A FILE TO kitchen.html? Add it here.
 */
const SHARED_ASSET = /^\/(assets\/[A-Za-z0-9._-]+|favicon\.svg|og\.png|theme-init\.js|fonts\/[a-z0-9-]+\.woff2)$/;

export function isSharedAsset(pathname: string): boolean {
  return SHARED_ASSET.test(pathname);
}

// Disallow everything. The public landing page tells professional kitchens that this is in
// development, and an indexed app on this host would make that claim false. When the product
// is announced, this file and that sentence change together.
export function kitchenRobots(): string {
  return ["User-agent: *", "Disallow: /", ""].join("\n");
}
