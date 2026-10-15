import type { Ingredient } from "./api/types";
import { normalizeItem } from "./api/normalizeItem";
import { categoryFor, CATEGORY_ORDER } from "./catalog";

export const OTHER = "Other";

export interface IngredientGroup { section: string | null; items: Ingredient[] }

// Group ingredients by section label, preserving first-seen order. A blank or
// whitespace-only section is treated as ungrouped (null).
export function groupIngredientsBySection(items: Ingredient[]): IngredientGroup[] {
  const groups: IngredientGroup[] = [];
  for (const g of items) {
    const key = g.section && g.section.trim() ? g.section : null;
    let grp = groups.find((x) => x.section === key);
    if (!grp) { grp = { section: key, items: [] }; groups.push(grp); }
    grp.items.push(g);
  }
  return groups;
}

// Group by the aisle each ingredient belongs to, for the "group by category"
// view. Categories keep the catalog's running order (produce first), and
// anything the catalog does not know falls into a trailing "Other" group so no
// ingredient can be silently dropped from the list.
export function groupIngredientsByCategory(
  items: Ingredient[], overrides?: Map<string, string>,
): IngredientGroup[] {
  const byCategory = new Map<string, Ingredient[]>();
  for (const g of items) {
    const key = categoryFor(g.item, overrides) ?? OTHER;
    byCategory.set(key, [...(byCategory.get(key) ?? []), g]);
  }
  // Known aisles in catalog order, then any aisle a family invented, then Other
  // last so unrecognised things stay at the bottom of the list.
  const known = new Set<string>([...CATEGORY_ORDER, OTHER]);
  const ordered = [...CATEGORY_ORDER.filter((c) => byCategory.has(c))];
  ordered.push(...[...byCategory.keys()].filter((c) => !known.has(c)).sort());
  if (byCategory.has(OTHER)) ordered.push(OTHER);
  return ordered.map((section) => ({ section, items: byCategory.get(section)! }));
}

// Whether an ingredient is an alternative rather than something to fetch in its own right.
// Decided across the WHOLE list, never inside a rendered group: the category view can split a
// group across two aisles, and then that fragment's first row would read as a required
// ingredient instead of an alternative to something elsewhere on the page.
export function alternativesOf(all: Ingredient[]): Set<Ingredient> {
  const firstOfGroup = new Map<string, Ingredient>();
  for (const g of all) {
    if (g.alt_group && !firstOfGroup.has(g.alt_group)) firstOfGroup.set(g.alt_group, g);
  }
  return new Set(all.filter((g) => g.alt_group && firstOfGroup.get(g.alt_group) !== g));
}

// The ingredients a step actually mentions, for the list rendered under that step in Cook
// Mode. Pure and separate from the component so the matching rule can be tested without
// rendering anything.
//
// WHOLE WORDS ONLY. The obvious implementation is `stepText.includes(key)`, and it matches
// "oil" inside "boil", "rice" inside "price" and "egg" inside "eggplant". Every match here
// is padded with spaces and searched in a padded haystack for that reason.
//
// A step that mentions nothing returns an EMPTY array, and the caller renders nothing. That
// is deliberate: the full ingredient list is one tap away, and a WRONG ingredient under a
// step is worse than none. Recipes written as prose ("add the rest and simmer") legitimately
// match nothing.
export function ingredientsForStep(items: Ingredient[], stepText: string): Ingredient[] {
  const haystack = ` ${normalizeWords(stepText)} `;
  return items.filter((g) => {
    if (!g.item || !g.item.trim()) return false;
    // Two chances. normalizeItem strips prep words and applies synonyms, so an ingredient
    // written "aubergine" becomes "eggplant" and would never be found in a step that says
    // aubergine. The raw name is tried as well to cover exactly that asymmetry.
    const needles = [normalizeItem(g.item), g.item.toLowerCase().trim()]
      .map((n) => normalizeWords(n))
      .filter((n) => n !== "");
    return needles.some((n) => haystack.includes(` ${n} `));
  });
}

// Lowercase, drop punctuation, collapse whitespace, and singularize each word the same way
// normalizeItem does, so "onions" in a step matches the ingredient "onion".
function normalizeWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "")
    .map((w) => singularize(w))
    .join(" ");
}

function singularize(w: string): string {
  if (w.endsWith("ies") && w.length > 3) return `${w.slice(0, -3)}y`;
  if (/(oes|ses|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 2) return w.slice(0, -1);
  return w;
}
