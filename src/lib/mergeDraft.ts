import type { RecipeDraft } from "./api/types";

// Merge an AI-extracted draft into the current one for editing: append the lists, fill only
// empty scalar fields, and never overwrite existing text (including the title).
export function mergeDraft(current: RecipeDraft, incoming: RecipeDraft): RecipeDraft {
  return {
    title: current.title || incoming.title,
    story: current.story || incoming.story,
    provenance: current.provenance || incoming.provenance,
    servings: current.servings ?? incoming.servings,
    prep_minutes: current.prep_minutes ?? incoming.prep_minutes,
    cook_minutes: current.cook_minutes ?? incoming.cook_minutes,
    source_url: current.source_url ?? incoming.source_url,
    ingredients: [...current.ingredients, ...incoming.ingredients],
    steps: [...current.steps, ...incoming.steps],
  };
}
