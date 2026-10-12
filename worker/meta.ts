// The shared link-preview card, with a version on it. Facebook, WhatsApp, Slack and X all
// cache a preview by its image URL and will happily serve a picture that no longer exists on
// the site for weeks. Bumping this number is what makes them fetch again, so REDRAWING
// public/og.png without bumping it means nobody sees the new one.
export const OG_CARD = "/og.png?v=2";

// Pure helpers for the per-recipe OpenGraph tags the Worker injects. Kept free of
// Worker globals so they can be unit tested without a runtime.

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

// Anchored, so /recipes/:id/edit and /recipes/:id/cook do not match: those are
// app-only routes with nothing worth previewing.
const RECIPE_PATH = new RegExp(`^/recipes/(${UUID})/?$`);
const OG_PATH = new RegExp(`^/og/recipe/(${UUID})\\.jpg$`);
// Same character class as the handle check constraint in 0020, and anchored. This value is
// interpolated into a PostgREST filter, so the pattern is the sanitiser: nothing outside
// [a-z0-9_] can reach it.
const AVATAR_PATH = new RegExp("^/avatar/([a-z0-9_]{3,30})\\.jpg$");

const TITLE_SUFFIX = " - The Enamel Vault";
const STOCK_DESCRIPTION = "A recipe from The Enamel Vault.";
const STOCK_IMAGE_ALT = "Family Recipes, on an enamel plate against a pantry-green wall.";
const DESCRIPTION_LIMIT = 160;

export function recipeIdFromPath(pathname: string): string | null {
  const match = RECIPE_PATH.exec(pathname);
  return match ? match[1] : null;
}

export function ogIdFromPath(pathname: string): string | null {
  const match = OG_PATH.exec(pathname);
  return match ? match[1] : null;
}

export function avatarHandleFromPath(pathname: string): string | null {
  const match = AVATAR_PATH.exec(pathname);
  return match ? match[1] : null;
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type BuildTagsInput = {
  title: string;
  story: string | null;
  id: string;
  hasPhoto: boolean;
  origin: string;
};

export type Tags = {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
};

function describe(story: string | null): string {
  const collapsed = (story ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return STOCK_DESCRIPTION;
  if (collapsed.length <= DESCRIPTION_LIMIT) return collapsed;

  const cut = collapsed.slice(0, DESCRIPTION_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");
  const head = (lastSpace === -1 ? cut : cut.slice(0, lastSpace)).replace(/[\s,;:.]+$/, "");
  return `${head}...`;
}

// EVERY route in the family app is served the SAME index.html, whose canonical and og:url
// are hardcoded to the site root. So a crawler asking for /help was told, by the page itself,
// that the real address is / - and Google did exactly what it was told, filing five of the
// seven URLs in the sitemap as "Alternate page with proper canonical tag" and indexing none
// of them. A self-referencing canonical is the default-correct answer for any shell route,
// which is why shellTags() answers for every path rather than only the ones listed below.
//
// ADD A PUBLIC ROUTE TO THE SITEMAP? Add its copy here too, or it ships with the homepage's
// title and description on it. worker/meta.test.ts fails if a sitemap path has no entry.
export const PUBLIC_PAGE_COPY: Record<string, { title: string; description: string }> = {
  "/terms": {
    title: "Terms and acceptable use",
    description:
      "The terms for using The Enamel Vault: what you may keep here, what we may remove, and what we promise in return.",
  },
  "/privacy": {
    title: "Privacy policy",
    description:
      "What The Enamel Vault stores, who it is shared with, every third party it reaches, and how to get a copy or have it deleted.",
  },
  "/cookies": {
    title: "Cookies and local storage",
    description:
      "The Enamel Vault sets no cookies and runs no trackers. What it does keep in your browser, and why that needs no consent banner.",
  },
  "/help": {
    title: "Help",
    description:
      "How to add a recipe, invite your family, import from a photo or a link, and what to do when something goes wrong.",
  },
};

// The public pages the sitemap offers Google, beyond the recipes and cooks read from the
// database. It lives HERE, next to the copy table, because the test that keeps the two in
// step can only read both if they are in the same importable module: worker/index.ts has no
// unit test, since HTMLRewriter and ASSETS have no implementation under Vitest.
export const STATIC_SITEMAP_PATHS = ["/terms", "/privacy", "/cookies", "/help"];

export type ShellTags = { url: string; title?: string; description?: string };

export function shellTags(pathname: string, origin: string): ShellTags {
  // Trailing slashes stripped, and the query dropped entirely: /help/ and /help?next=x are
  // the same page, and a canonical that carries ?next= would invite Google to index a
  // sign-in redirect as a page in its own right.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
  const copy = PUBLIC_PAGE_COPY[path];
  if (!copy) return { url: `${origin}${path}` };
  return {
    url: `${origin}${path}`,
    title: `${copy.title}${TITLE_SUFFIX}`,
    description: copy.description,
  };
}

export type SitemapEntry = { loc: string; lastmod?: string | null };

export function buildSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const loc = `    <loc>${escapeAttr(entry.loc)}</loc>`;
    // Google wants a date, not a timestamp, and Supabase hands back a full ISO string, so the
    // first ten characters are the YYYY-MM-DD prefix. An empty lastmod is dropped rather than
    // emitted as an empty element, which is an invalid field.
    // typeof, not just truthiness: lastmod comes from unvalidated Supabase JSON, and
    // serveSitemap builds its Response outside the try, so a non-string here would throw
    // straight out of the route as a 500. A sitemap may be incomplete, never fail.
    const lastmod =
      typeof entry.lastmod === "string" && entry.lastmod !== ""
        ? `\n    <lastmod>${entry.lastmod.slice(0, 10)}</lastmod>`
        : "";
    return `  <url>\n${loc}${lastmod}\n  </url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export type JsonLdInput = {
  title: string;
  description: string;
  url: string;
  image: string;
  ingredients: string[];
  steps: string[];
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  authorName: string | null;
};

// A key with a null value is worse than an absent key: Google reports it as an invalid field,
// so every optional property is added only when it has a real value.
function minutes(value: number | null): string | null {
  return typeof value === "number" && value > 0 ? `PT${value}M` : null;
}

export function buildRecipeJsonLd(input: JsonLdInput): string {
  const recipe: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: input.title,
    description: input.description,
    url: input.url,
    image: [input.image],
  };

  if (input.ingredients.length > 0) recipe.recipeIngredient = input.ingredients;
  if (input.steps.length > 0) {
    recipe.recipeInstructions = input.steps.map((text) => ({ "@type": "HowToStep", text }));
  }
  if (typeof input.servings === "number" && input.servings > 0) {
    recipe.recipeYield = `${input.servings} servings`;
  }
  const prepTime = minutes(input.prepMinutes);
  if (prepTime) recipe.prepTime = prepTime;
  const cookTime = minutes(input.cookMinutes);
  if (cookTime) recipe.cookTime = cookTime;
  if (input.authorName) recipe.author = { "@type": "Person", name: input.authorName };

  // The JSON sits inside a <script> element, where the HTML parser is still looking for
  // </script>, and JSON.stringify does not escape it: a story containing </script> would break
  // out of the tag. Escaping every < as \u003c is valid JSON and closes that hole. escapeAttr
  // is wrong here: HTML entities inside a script element would corrupt the JSON.
  const json = JSON.stringify(recipe).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

export function buildTags(input: BuildTagsInput): Tags {
  const { title, story, id, hasPhoto, origin } = input;
  return {
    title: `${title}${TITLE_SUFFIX}`,
    description: describe(story),
    url: `${origin}/recipes/${id}`,
    image: hasPhoto ? `${origin}/og/recipe/${id}.jpg` : `${origin}${OG_CARD}`,
    imageAlt: hasPhoto ? `${title} - a photo of the recipe` : STOCK_IMAGE_ALT,
  };
}

export function securityHeaders(supabase: string): Record<string, string> {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: " + supabase,
      "font-src 'self'",
      "connect-src 'self' " + supabase + " " + supabase.replace(/^https:/, "wss:"),
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
    // Stops a browser second-guessing a Content-Type, which is how a user-uploaded photo gets
    // treated as a script.
    "X-Content-Type-Options": "nosniff",
    // A recipe id in a path is not secret, but there is no reason to hand it to every site a
    // visitor clicks through to.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // The app asks for none of these, so refusing them all costs nothing and removes them as
    // something an injected script could reach for.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    // Two years, subdomains included. Only ever sent over https, so a local http dev server is
    // unaffected, and Cloudflare terminates TLS in front of this anyway.
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  };
}
