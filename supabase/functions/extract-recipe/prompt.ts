// System prompt and JSON schema for the extract-recipe model call.
// The model only ever proposes a draft; a human reviews it before saving.

export const SYSTEM_PROMPT = `Extract a recipe into the given JSON schema. Leave any field you cannot find blank (empty string, empty array, or null). Never invent quantities, ingredients, or steps.

Ingredient amounts (the input may be a spoken transcript, so phrasing is loose):
- quantity holds ONLY a number. Never put a unit, a word, or any other text in it. Allowed shapes: "2", "2.5", "1/2", "1 1/2", or a range like "2-3".
- unit holds the unit of measure on its own, singular: "tablespoon", "cup", "clove", "can". Use null if no unit was stated.
- Convert worded numbers to digits: "two" -> "2", "half a cup" -> quantity "1/2" and unit "cup", "a couple of" -> "2", "a" or "an" before a unit -> "1".
- A size describing the container or piece belongs in item, not quantity: "one 28-ounce can of crushed tomatoes" -> quantity "1", unit "can", item "28-ounce crushed tomatoes".
- An amount RESTATED in another unit, usually bracketed, is the same amount twice. Keep the first and drop the bracketed one; never put it in item: "1/2 tsp (2 mL) salt" -> quantity "1/2", unit "teaspoon", item "salt". "1 lb (450 g) pork ribs" -> quantity "1", unit "pound", item "pork ribs". This is NOT the rule above: "28-ounce" describes the can you buy, "(2 mL)" is one half-teaspoon said twice.
- Drop cookbook cross-references: "Smoky BBQ Sauce (page 341) or store-bought" -> item "Smoky BBQ Sauce or store-bought".
- item is the ingredient NAME. It must never begin with a number or a bracketed amount.
- Amounts with no number ("a pinch", "to taste", "for garnish") go in unit or item, with quantity null.
- optional is true ONLY when the recipe itself says so ("optional", "if you like", "to taste", "for garnish"). Never infer it because an ingredient seems minor. Default false.
- Do NOT try to pair ingredients as alternatives to each other. If the recipe says "cream (or yogurt)", that is ONE ingredient and the text stays in item. Guessing wrong would silently remove something from a shopping list.

servings is an integer. Read it from any phrasing of yield, including spoken ones: "it serves four" -> 4, "feeds a family of six" -> 6, "makes 12 cookies" -> 12. Use null only when no yield is mentioned at all.`;

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Recipe title, empty string if unknown" },
    story: { type: "string", description: "Any narrative or background text, empty string if unknown" },
    provenance: { type: "string", description: "Where the recipe came from, empty string if unknown" },
    servings: { type: ["integer", "null"], description: "Number of servings as an integer, null only if no yield is mentioned" },
    prep_minutes: { type: ["integer", "null"], description: "Prep time in minutes, null if unknown" },
    cook_minutes: { type: ["integer", "null"], description: "Cook time in minutes, null if unknown" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          position: { type: "integer", description: "Zero-based order in the list" },
          quantity: { type: ["string", "null"], description: "Number only, no unit or words: \"2\", \"2.5\", \"1/2\", \"1 1/2\", \"2-3\". null if not stated" },
          unit: { type: ["string", "null"], description: "Unit of measure alone and singular (cup, tablespoon, can), null if not stated" },
          item: { type: "string", description: "The ingredient itself" },
          optional: { type: "boolean", description: "True only if the recipe calls it optional, to taste, or for garnish. Default false" },
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
