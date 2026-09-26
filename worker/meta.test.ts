import { test, expect } from "vitest";
import { buildTags, escapeAttr, ogIdFromPath, recipeIdFromPath } from "./meta";

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
