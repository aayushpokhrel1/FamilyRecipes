import { test, expect, describe, it } from "vitest";
// ?raw, not node:fs: tsconfig.worker.json has no node types on purpose, because
// worker code must not be able to reach for fs, and a test in worker/ is covered by
// that same project. src/lib/sourceFiles.ts says the same thing for src/.
import workerSource from "./index.ts?raw";
import {
  avatarHandleFromPath,
  imageContentType,
  buildCookTags,
  buildRecipeJsonLd,
  buildSitemap,
  cookHandleFromPath,
  securityHeaders,
  buildTags,
  escapeAttr,
  ogIdFromPath,
  recipeIdFromPath,
  shellTags,
  truncateDescription,
  PUBLIC_PAGE_COPY,
  STATIC_SITEMAP_PATHS,
  type JsonLdInput,
} from "./meta";

const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const ORIGIN = "https://recipes.enamelvault.com";

test("recipeIdFromPath matches a bare recipe path and a trailing slash", () => {
  expect(recipeIdFromPath(`/recipes/${ID}`)).toBe(ID);
  expect(recipeIdFromPath(`/recipes/${ID}/`)).toBe(ID);
});

test("recipeIdFromPath returns the id as written, not lowercased", () => {
  const upper = ID.toUpperCase();
  expect(recipeIdFromPath(`/recipes/${upper}`)).toBe(upper);
});

test("recipeIdFromPath ignores app-only routes and non-recipe paths", () => {
  expect(recipeIdFromPath(`/recipes/${ID}/edit`)).toBeNull();
  expect(recipeIdFromPath(`/recipes/${ID}/cook`)).toBeNull();
  expect(recipeIdFromPath(`/recipes/${ID}/anything`)).toBeNull();
  expect(recipeIdFromPath("/recipes/new")).toBeNull();
  expect(recipeIdFromPath("/recipes")).toBeNull();
  expect(recipeIdFromPath("/recipes/abc")).toBeNull();
  expect(recipeIdFromPath(`/kitchen/recipes/${ID}`)).toBeNull();
});

test("ogIdFromPath matches the .jpg proxy route", () => {
  expect(ogIdFromPath(`/og/recipe/${ID}.jpg`)).toBe(ID);
});

test("ogIdFromPath rejects a missing or wrong extension", () => {
  expect(ogIdFromPath(`/og/recipe/${ID}`)).toBeNull();
  expect(ogIdFromPath(`/og/recipe/${ID}.png`)).toBeNull();
  expect(ogIdFromPath("/og/recipe/abc.jpg")).toBeNull();
});

test("escapeAttr escapes a double-quoted attribute value", () => {
  expect(escapeAttr(`Ben & Jerry's "best" <cake>`)).toBe(
    "Ben &amp; Jerry's &quot;best&quot; &lt;cake&gt;",
  );
});

test("escapeAttr does not double-escape the ampersand", () => {
  const escaped = escapeAttr("Ben & Jerry's");
  expect(escaped).toContain("&amp;");
  expect(escaped).not.toContain("&amp;amp;");
});

test("buildTags appends the site suffix to the title", () => {
  const tags = buildTags({ title: "Besan chila", story: null, id: ID, hasPhoto: false, origin: ORIGIN });
  expect(tags.title).toBe("Besan chila - The Enamel Vault");
  expect(tags.url).toBe(`${ORIGIN}/recipes/${ID}`);
});

test("buildTags falls back to the static card and stock alt without a photo", () => {
  const tags = buildTags({ title: "Besan chila", story: null, id: ID, hasPhoto: false, origin: ORIGIN });
  expect(tags.image).toBe(`${ORIGIN}/og.png?v=2`);
  expect(tags.imageAlt).toBe("Family Recipes, on an enamel plate against a pantry-green wall.");
});

test("buildTags uses the proxy image and the raw title in the alt with a photo", () => {
  const tags = buildTags({ title: "Besan chila", story: null, id: ID, hasPhoto: true, origin: ORIGIN });
  expect(tags.image).toBe(`${ORIGIN}/og/recipe/${ID}.jpg`);
  expect(tags.imageAlt).toBe("Besan chila - a photo of the recipe");
});

test("buildTags uses the stock description when the story is missing", () => {
  const stock = "A recipe from The Enamel Vault.";
  for (const story of [null, "", "   \n  "]) {
    expect(buildTags({ title: "Besan chila", story, id: ID, hasPhoto: false, origin: ORIGIN }).description)
      .toBe(stock);
  }
});

test("buildTags collapses newlines and runs of spaces in the story", () => {
  const tags = buildTags({
    title: "Besan chila",
    story: "  My grandmother\n\nmade   this every\tSunday.  ",
    id: ID,
    hasPhoto: false,
    origin: ORIGIN,
  });
  expect(tags.description).toBe("My grandmother made this every Sunday.");
});

test("buildTags truncates a long story on a word boundary", () => {
  const story = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  const { description } = buildTags({ title: "Besan chila", story, id: ID, hasPhoto: false, origin: ORIGIN });
  expect(description.endsWith("...")).toBe(true);
  expect(description.length).toBeLessThanOrEqual(163);
  const body = description.slice(0, -3);
  expect(story.startsWith(body)).toBe(true);
  // the character after the cut is the space the truncation landed on, so no word was split
  expect(story[body.length]).toBe(" ");
  expect(body.endsWith("word")).toBe(false);
});

test("buildTags strips trailing punctuation before the ellipsis", () => {
  const story = `${"a".repeat(150)}, and then some more words that push it well past the limit`;
  const { description } = buildTags({ title: "Besan chila", story, id: ID, hasPhoto: false, origin: ORIGIN });
  expect(description.endsWith("...")).toBe(true);
  expect(description.length).toBeLessThanOrEqual(163);
  expect(description.slice(0, -3)).not.toMatch(/[\s,;:.]$/);
});

test("buildTags leaves values raw for the caller to escape", () => {
  const tags = buildTags({
    title: `Ben & Jerry's "best"`,
    story: null,
    id: ID,
    hasPhoto: true,
    origin: ORIGIN,
  });
  expect(tags.title).toBe(`Ben & Jerry's "best" - The Enamel Vault`);
  expect(tags.imageAlt).toBe(`Ben & Jerry's "best" - a photo of the recipe`);
});

describe("avatarHandleFromPath", () => {
  it("matches a handle", () => {
    expect(avatarHandleFromPath("/avatar/aayush.jpg")).toBe("aayush");
    expect(avatarHandleFromPath("/avatar/cook_2.jpg")).toBe("cook_2");
  });
  it("refuses anything that is not a handle", () => {
    // Anchored, and the same character class as the DB constraint, so a path cannot smuggle
    // a traversal or a query into the PostgREST filter this value is interpolated into.
    expect(avatarHandleFromPath("/avatar/../secret.jpg")).toBeNull();
    expect(avatarHandleFromPath("/avatar/Aayush.jpg")).toBeNull();
    expect(avatarHandleFromPath("/avatar/a.jpg")).toBeNull();
    expect(avatarHandleFromPath("/avatar/aayush.png")).toBeNull();
    expect(avatarHandleFromPath("/avatar/aayush.jpg/more")).toBeNull();
  });
});

describe("buildSitemap", () => {
  it("emits a valid empty urlset with no entries", () => {
    const xml = buildSitemap([]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
  });

  it("emits a loc and a date-only lastmod when one is given", () => {
    const xml = buildSitemap([
      { loc: `${ORIGIN}/recipes/${ID}`, lastmod: "2026-09-27T14:03:11.123456+00:00" },
    ]);
    expect(xml).toContain(`<loc>${ORIGIN}/recipes/${ID}</loc>`);
    expect(xml).toContain("<lastmod>2026-09-27</lastmod>");
    expect(xml).not.toContain("T14:03:11");
  });

  it("omits lastmod entirely when it is missing or empty", () => {
    for (const lastmod of [undefined, null, ""]) {
      const xml = buildSitemap([{ loc: `${ORIGIN}/help`, lastmod }]);
      expect(xml).toContain(`<loc>${ORIGIN}/help</loc>`);
      expect(xml).not.toContain("<lastmod>");
    }
  });

  it("escapes an ampersand in a loc", () => {
    const xml = buildSitemap([{ loc: `${ORIGIN}/cooks/ben&jerry` }]);
    expect(xml).toContain(`<loc>${ORIGIN}/cooks/ben&amp;jerry</loc>`);
    expect(xml).not.toContain("ben&jerry");
  });
});

const JSON_LD_BASE: JsonLdInput = {
  title: "Besan chila",
  description: "A recipe from The Enamel Vault.",
  url: `${ORIGIN}/recipes/${ID}`,
  image: `${ORIGIN}/og.png?v=2`,
  ingredients: [],
  steps: [],
  servings: null,
  prepMinutes: null,
  cookMinutes: null,
  authorName: null,
};

function parseJsonLd(script: string): Record<string, unknown> {
  const open = '<script type="application/ld+json">';
  expect(script.startsWith(open)).toBe(true);
  expect(script.endsWith("</script>")).toBe(true);
  return JSON.parse(script.slice(open.length, -"</script>".length)) as Record<string, unknown>;
}

describe("buildRecipeJsonLd", () => {
  it("omits every optional field when it is null or empty", () => {
    const recipe = parseJsonLd(buildRecipeJsonLd(JSON_LD_BASE));
    expect(recipe["@context"]).toBe("https://schema.org");
    expect(recipe["@type"]).toBe("Recipe");
    expect(recipe.name).toBe("Besan chila");
    expect(recipe.image).toEqual([`${ORIGIN}/og.png?v=2`]);
    for (const key of [
      "recipeIngredient",
      "recipeInstructions",
      "recipeYield",
      "prepTime",
      "cookTime",
      "author",
    ]) {
      expect(recipe).not.toHaveProperty(key);
    }
  });

  it("emits PT20M style durations and a recipeYield", () => {
    const recipe = parseJsonLd(
      buildRecipeJsonLd({ ...JSON_LD_BASE, servings: 4, prepMinutes: 20, cookMinutes: 35 }),
    );
    expect(recipe.prepTime).toBe("PT20M");
    expect(recipe.cookTime).toBe("PT35M");
    expect(recipe.recipeYield).toBe("4 servings");
  });

  it("omits a non-positive duration or serving count", () => {
    const recipe = parseJsonLd(
      buildRecipeJsonLd({ ...JSON_LD_BASE, servings: 0, prepMinutes: 0, cookMinutes: -5 }),
    );
    expect(recipe).not.toHaveProperty("recipeYield");
    expect(recipe).not.toHaveProperty("prepTime");
    expect(recipe).not.toHaveProperty("cookTime");
  });

  it("emits ingredients, HowToStep instructions and an author when present", () => {
    const recipe = parseJsonLd(
      buildRecipeJsonLd({
        ...JSON_LD_BASE,
        ingredients: ["2 eggs", "1 cup besan"],
        steps: ["Whisk the batter.", "Rest it for an hour."],
        authorName: "Aayush",
      }),
    );
    expect(recipe.recipeIngredient).toEqual(["2 eggs", "1 cup besan"]);
    expect(recipe.recipeInstructions).toEqual([
      { "@type": "HowToStep", text: "Whisk the batter." },
      { "@type": "HowToStep", text: "Rest it for an hour." },
    ]);
    expect(recipe.author).toEqual({ "@type": "Person", name: "Aayush" });
  });

  it("escapes a </script> in the content so it cannot break out of the tag", () => {
    const script = buildRecipeJsonLd({
      ...JSON_LD_BASE,
      title: "Besan chila </script><script>alert(1)</script>",
    });
    // Only the closing tag this function writes may survive as a literal.
    expect(script.split("</script").length - 1).toBe(1);
    expect(script.endsWith("</script>")).toBe(true);
    expect(script).toContain("\\u003c/script");
    // The escaping is JSON, not HTML entities, so the value still parses back intact.
    expect(parseJsonLd(script).name).toBe("Besan chila </script><script>alert(1)</script>");
  });
});

// Regression: lastmod is read straight out of unvalidated Supabase JSON, and serveSitemap
// builds its Response OUTSIDE its try, so a row whose updated_at is not a string used to
// throw out of the route as a 500. An incomplete sitemap is fine; a failed one is not.
test("buildSitemap drops a lastmod that is not a string instead of throwing", () => {
  const xml = buildSitemap([
    { loc: "https://x.dev/a", lastmod: 20260101 as unknown as string },
    { loc: "https://x.dev/b", lastmod: {} as unknown as string },
  ]);
  expect(xml).not.toContain("<lastmod>");
  expect(xml).toContain("<loc>https://x.dev/a</loc>");
  expect(xml).toContain("<loc>https://x.dev/b</loc>");
});

// The Content-Security-Policy is the one header here doing real work, and the way a CSP fails
// is silent: a directive that is too tight blocks something and the page half-works, a
// directive that is too loose protects nothing and nobody notices either. These pin the
// decisions that were actually reasoned about.
describe("securityHeaders", () => {
  const h = securityHeaders("https://proj.supabase.co");
  const csp = h["Content-Security-Policy"];

  it("forbids inline script, which is the whole point", () => {
    expect(csp).toContain("script-src 'self'");
    // If this ever appears, the policy has stopped defending against the thing it exists for.
    expect(csp).not.toContain("'unsafe-inline' 'self'");
    expect(csp.split("; ").find((d) => d.startsWith("script-src"))).toBe("script-src 'self'");
  });

  it("allows inline STYLE, because style={{...}} attributes are counted as inline styles", () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("lets the browser reach Supabase, which it talks to directly", () => {
    expect(csp).toContain("connect-src 'self' https://proj.supabase.co wss://proj.supabase.co");
    // Signed photo URLs are fetched straight from storage by the page.
    expect(csp).toContain("img-src 'self' data: blob: https://proj.supabase.co");
  });

  it("refuses framing and plugins, and pins the base URI", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("is enforcing, never report-only", () => {
    // A report-only policy with no reporting endpoint does nothing at all, while reading like
    // protection, which is worse than having none.
    expect(h["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("sends the cheap headers too", () => {
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Strict-Transport-Security"]).toContain("max-age=");
    expect(h["Permissions-Policy"]).toContain("camera=()");
  });
});

// Google filed five of the seven sitemap URLs as "Alternate page with proper canonical tag"
// and indexed none of them, because index.html hardcodes the root as its canonical and every
// route is served that same file. These are the checks that stop it happening again: both
// were confirmed to fail before shellTags existed.
describe("shellTags", () => {
  it("canonicalises a page to itself, not to the site root", () => {
    expect(shellTags("/help", "https://recipes.enamelvault.com").url).toBe(
      "https://recipes.enamelvault.com/help",
    );
  });

  it("canonicalises the root to the root", () => {
    expect(shellTags("/", "https://recipes.enamelvault.com").url).toBe(
      "https://recipes.enamelvault.com/",
    );
  });

  it("treats a trailing slash as the same page", () => {
    expect(shellTags("/privacy/", "https://x.test").url).toBe("https://x.test/privacy");
  });

  it("gives a public document its own title and description", () => {
    const tags = shellTags("/terms", "https://x.test");
    expect(tags.title).toBe("Terms and acceptable use - The Enamel Vault");
    expect(tags.description).toContain("terms");
  });

  // A route with no copy must keep index.html's own wording rather than be handed a blank
  // title: an undefined here is what makes the rewriter leave the element alone.
  it("leaves the shell's wording alone for a route it has no copy for", () => {
    const tags = shellTags("/settings", "https://x.test");
    // The canonical is still its own, which is the half that matters to a crawler: this
    // assertion is the one that goes red if the no-copy branch ever falls back to the root.
    expect(tags.url).toBe("https://x.test/settings");
    expect(tags.title).toBeUndefined();
    expect(tags.description).toBeUndefined();
  });

  it("has copy for every static path the sitemap offers Google", () => {
    for (const path of STATIC_SITEMAP_PATHS) {
      expect(PUBLIC_PAGE_COPY[path], `${path} is in the sitemap with no copy`).toBeDefined();
    }
  });

  // Google truncates around 160; more than that is wasted, and an empty one is worse than
  // the homepage's.
  it("keeps every description a usable length", () => {
    for (const [path, copy] of Object.entries(PUBLIC_PAGE_COPY)) {
      expect(copy.description.length, `${path} description`).toBeGreaterThan(50);
      expect(copy.description.length, `${path} description`).toBeLessThanOrEqual(170);
    }
  });
});

describe("cookHandleFromPath", () => {
  it("matches a public cook page", () => {
    expect(cookHandleFromPath("/cooks/yusha")).toBe("yusha");
  });

  it("tolerates a trailing slash", () => {
    expect(cookHandleFromPath("/cooks/yusha/")).toBe("yusha");
  });

  // This pattern is the sanitiser: the value is interpolated into a PostgREST filter, so
  // anything it lets through reaches the query. Same character class as the handle check
  // constraint in migration 0020.
  it("refuses anything outside the handle character class", () => {
    expect(cookHandleFromPath("/cooks/Yusha")).toBeNull();
    expect(cookHandleFromPath("/cooks/bad.handle")).toBeNull();
    expect(cookHandleFromPath("/cooks/bad-handle")).toBeNull();
    expect(cookHandleFromPath("/cooks/no")).toBeNull();
    expect(cookHandleFromPath("/cooks/" + "x".repeat(31))).toBeNull();
  });

  it("is anchored, so it does not match a longer path or a suffix", () => {
    expect(cookHandleFromPath("/cooks/yusha/recipes")).toBeNull();
    expect(cookHandleFromPath("/evil/cooks/yusha")).toBeNull();
  });
});

describe("truncateDescription", () => {
  it("reads whitespace only as absent", () => {
    expect(truncateDescription("   \n  ")).toBeNull();
    expect(truncateDescription(null)).toBeNull();
  });

  it("collapses runs of whitespace", () => {
    expect(truncateDescription("a\n\n  b")).toBe("a b");
  });

  it("cuts at a word boundary and marks the cut", () => {
    const long = "word ".repeat(60);
    const out = truncateDescription(long)!;
    expect(out.length).toBeLessThanOrEqual(164);
    expect(out.endsWith("...")).toBe(true);
    expect(out).not.toContain("word word...word");
  });
});

describe("buildCookTags", () => {
  it("uses the cook's published name", () => {
    const tags = buildCookTags({
      publicName: "Yusha",
      handle: "yusha",
      bio: "Cooks mostly Nepali food.",
      origin: "https://x.test",
    });
    expect(tags.title).toBe("Yusha - The Enamel Vault");
    expect(tags.description).toBe("Cooks mostly Nepali food.");
    expect(tags.url).toBe("https://x.test/cooks/yusha");
  });

  // public_name is nullable in 0020: a cook can claim a handle without publishing a name,
  // and "null - The Enamel Vault" is what a missing fallback ships.
  it("falls back to the handle when no name is published", () => {
    const tags = buildCookTags({
      publicName: null,
      handle: "yusha",
      bio: null,
      origin: "https://x.test",
    });
    expect(tags.title).toBe("yusha - The Enamel Vault");
  });

  it("falls back to a stock line when there is no bio", () => {
    const tags = buildCookTags({
      publicName: "Yusha",
      handle: "yusha",
      bio: "   ",
      origin: "https://x.test",
    });
    expect(tags.description).toBe("Recipes published by Yusha on The Enamel Vault.");
  });

  it("keeps a long bio inside the description limit", () => {
    const tags = buildCookTags({
      publicName: "Yusha",
      handle: "yusha",
      bio: "a".repeat(400),
      origin: "https://x.test",
    });
    expect(tags.description!.length).toBeLessThanOrEqual(164);
  });
});

describe("imageContentType", () => {
  it("keeps the real image types", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]) {
      expect(imageContentType(t)).toBe(t);
    }
  });

  it("refuses the types that make a proxied object executable on this origin", () => {
    // Each of these, served from the app origin, defeats script-src 'self': the HTML ones
    // become a document, and the script ones become a loadable same-origin script inside it.
    for (const t of ["text/html", "text/javascript", "application/javascript",
                     "application/xhtml+xml", "text/xml"]) {
      expect(imageContentType(t)).toBe("image/jpeg");
    }
  });

  it("refuses SVG, which is a document that can carry script", () => {
    expect(imageContentType("image/svg+xml")).toBe("image/jpeg");
  });

  it("falls back when storage says nothing at all", () => {
    expect(imageContentType(null)).toBe("image/jpeg");
    expect(imageContentType("")).toBe("image/jpeg");
  });

  it("reads the type out of a full header, and is not fooled by case or padding", () => {
    expect(imageContentType("image/PNG; charset=utf-8")).toBe("image/png");
    expect(imageContentType("  image/webp  ")).toBe("image/webp");
    // A parameter must not smuggle a second type past the match.
    expect(imageContentType("text/html; x=image/png")).toBe("image/jpeg");
  });
});

describe("the image proxies never hand back storage's own content type", () => {
  // A source pin, not a behaviour test, because serveOgImage and serveAvatar are not
  // exported and the bug was one expression inside each. This is the check that would have
  // caught it: both sites read the upstream header and passed it straight to the client.
  it("routes every proxied content-type through imageContentType", () => {
    const raw = workerSource.match(/"Content-Type":\s*\w+\.headers\.get\("content-type"\)/g) ?? [];
    expect(raw).toEqual([]);
    // Both proxies still set one, so the pin cannot pass by the handlers disappearing.
    expect(workerSource.match(/"Content-Type": imageContentType\(/g)?.length).toBe(2);
  });
});
