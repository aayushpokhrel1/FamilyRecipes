// Pure helpers for the per-recipe OpenGraph tags the Worker injects. Kept free of
// Worker globals so they can be unit tested without a runtime.

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

// Anchored, so /recipes/:id/edit and /recipes/:id/cook do not match: those are
// app-only routes with nothing worth previewing.
const RECIPE_PATH = new RegExp(`^/recipes/(${UUID})/?$`);
const OG_PATH = new RegExp(`^/og/recipe/(${UUID})\\.jpg$`);

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

export function buildTags(input: BuildTagsInput): Tags {
  const { title, story, id, hasPhoto, origin } = input;
  return {
    title: `${title}${TITLE_SUFFIX}`,
    description: describe(story),
    url: `${origin}/recipes/${id}`,
    image: hasPhoto ? `${origin}/og/recipe/${id}.jpg` : `${origin}/og.png`,
    imageAlt: hasPhoto ? `${title} - a photo of the recipe` : STOCK_IMAGE_ALT,
  };
}
