// Grouping key for the grocery list. Cheap normalization that merges the common
// cases (casing, whitespace, a trailing descriptor, common prep words, plurals).
// ponytail: naive heuristics only; synonym/LLM canonicalization is a deferred
// roadmap item (see the design doc). This function is the single upgrade seam.
const PREP_WORDS = new Set([
  "chopped", "diced", "minced", "sliced", "ground", "grated", "shredded",
  "crushed", "peeled", "fresh", "dried", "frozen", "canned", "cooked", "raw",
  "large", "small", "medium", "ripe", "boneless", "skinless",
]);

function singularizeWord(w: string): string {
  if (w.endsWith("ies") && w.length > 3) return w.slice(0, -3) + "y";
  if (/(oes|ses|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 2) return w.slice(0, -1);
  return w;
}

export function normalizeItem(item: string): string {
  let s = item.toLowerCase().split(",")[0];
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w && !PREP_WORDS.has(w));
  if (words.length) words[words.length - 1] = singularizeWord(words[words.length - 1]);
  return words.join(" ").trim();
}
