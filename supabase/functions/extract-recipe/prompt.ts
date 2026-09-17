// System prompt and JSON schema for the extract-recipe model call.
// The model only ever proposes a draft; a human reviews it before saving.

export const SYSTEM_PROMPT =
  "Extract a recipe into the given JSON schema. Leave any field you cannot find blank " +
  "(empty string, empty array, or null). Never invent quantities, ingredients, or steps.";

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Recipe title, empty string if unknown" },
    story: { type: "string", description: "Any narrative or background text, empty string if unknown" },
    provenance: { type: "string", description: "Where the recipe came from, empty string if unknown" },
    servings: { type: ["integer", "null"], description: "Number of servings, null if unknown" },
    prep_minutes: { type: ["integer", "null"], description: "Prep time in minutes, null if unknown" },
    cook_minutes: { type: ["integer", "null"], description: "Cook time in minutes, null if unknown" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          position: { type: "integer", description: "Zero-based order in the list" },
          quantity: { type: ["string", "null"], description: "Amount, null if not stated" },
          unit: { type: ["string", "null"], description: "Unit of measure, null if not stated" },
          item: { type: "string", description: "The ingredient itself" },
        },
        required: ["position", "item"],
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          position: { type: "integer", description: "Zero-based order in the list" },
          text: { type: "string", description: "The instruction text" },
        },
        required: ["position", "text"],
      },
    },
    source_url: { type: ["string", "null"], description: "Source URL, null if unknown" },
  },
  required: [
    "title",
    "story",
    "provenance",
    "servings",
    "prep_minutes",
    "cook_minutes",
    "ingredients",
    "steps",
    "source_url",
  ],
} as const;
