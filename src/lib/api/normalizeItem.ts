// Grouping key for the grocery list. Cheap normalization that merges the common
// cases (casing, whitespace, a trailing descriptor, common prep words, plurals).
// ponytail: naive heuristics only; synonym/LLM canonicalization is a deferred
// roadmap item (see the design doc). This function is the single upgrade seam.
const PREP_WORDS = new Set([
  "chopped", "diced", "minced", "sliced", "ground", "grated", "shredded",
  "crushed", "peeled", "fresh", "dried", "frozen", "canned", "cooked", "raw",
  "large", "small", "medium", "ripe", "boneless", "skinless",
]);

// Canonical names for items that are the same thing under different words.
// ponytail: curated data, not logic. A wrong entry silently merges two
// different ingredients, which is worse than not merging, so only add pairs
// that are genuinely identical. The LLM canonicalization pass, when it comes,
// replaces the lookup below without moving this call site.
const SYNONYMS: Record<string, string> = {
  "all purpose flour": "flour",
  "plain flour": "flour",
  "scallion": "green onion",
  "spring onion": "green onion",
  "garbanzo bean": "chickpea",
  // no coriander -> cilantro entry on purpose: "coriander" often means the
  // ground seed, a different purchase from the fresh herb, and "fresh" is a
  // PREP_WORD stripped before this map runs, so the two cannot be told apart
  "aubergine": "eggplant",
  "courgette": "zucchini",
  "caster sugar": "sugar",
  "granulated sugar": "sugar",
  "confectioners sugar": "powdered sugar",
  "icing sugar": "powdered sugar",
  "bicarbonate of soda": "baking soda",
};

function singularizeWord(w: string): string {
  if (w.endsWith("ies") && w.length > 3) return w.slice(0, -3) + "y";
  if (/(oes|ses|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 2) return w.slice(0, -1);
  return w;
}

// A parenthesised group CONTAINING A DIGIT is a quantity that leaked into the item
// name ("(2 mL) salt"), which extraction does often enough to matter: the key became
// "(2 ml) salt" and could never match the cupboard's "salt".
// Only with a digit, deliberately. A parenthetical without one is usually a real
// distinction ("chicken (thighs)"), and merging that into "chicken" would silently
// drop an ingredient, which this file holds is worse than not merging.
// Exported because the grocery list also shows the item, and "(2 mL) salt" is the
// same noise on screen as it is in the key.
export function stripLeakedQuantity(s: string): string {
  return s.replace(/\([^)]*\d[^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

// What a human should READ for an ingredient, as opposed to the grouping key.
// Extraction sometimes writes the amount into the item field ("(1.5 kg) boneless
// pork ribs"), and the quantity column next to it already says the amount, so the
// parenthetical is noise on screen as well as in the key.
// EVERY place that renders an ingredient's item to a reader goes through here:
// RecipeDetail, CookMode and the grocery list. Editors are the exception on
// purpose, because they edit the stored value and must show it unaltered.
// The `|| item` guard matters: an item that is ONLY a leaked quantity would
// otherwise render as an empty line, and a wrong label beats no label.
export function displayItem(item: string): string {
  return stripLeakedQuantity(item) || item;
}

export function normalizeItem(item: string): string {
  let s = stripLeakedQuantity(item.toLowerCase().split(",")[0]);
  s = s.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w && !PREP_WORDS.has(w));
  if (words.length) words[words.length - 1] = singularizeWord(words[words.length - 1]);
  const base = words.join(" ").trim();
  return SYNONYMS[base] ?? base;
}
