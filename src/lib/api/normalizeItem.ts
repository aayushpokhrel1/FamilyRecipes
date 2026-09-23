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

export function normalizeItem(item: string): string {
  let s = item.toLowerCase().split(",")[0];
  s = s.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w && !PREP_WORDS.has(w));
  if (words.length) words[words.length - 1] = singularizeWord(words[words.length - 1]);
  const base = words.join(" ").trim();
  return SYNONYMS[base] ?? base;
}
