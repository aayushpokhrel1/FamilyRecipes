import { test, expect, describe, it } from "vitest";
import {
  avatarHandleFromPath,
  buildRecipeJsonLd,
  buildSitemap,
  securityHeaders,
  buildTags,
  escapeAttr,
  ogIdFromPath,
  recipeIdFromPath,
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
  expect(tags.image).toBe(`${ORIGIN}/og.png`);
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
  image: `${ORIGIN}/og.png`,
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
    expect(recipe.image).toEqual([`${ORIGIN}/og.png`]);
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
