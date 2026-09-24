import { normalizeItem } from "./api/normalizeItem";
export interface CatalogCategory { category: string; items: string[] }

export const CATALOG: CatalogCategory[] = [
  {
    category: "Produce",
    items: [
      "onion",
      "garlic",
      "tomato",
      "carrot",
      "celery",
      "bell pepper",
      "potato",
      "sweet potato",
      "zucchini",
      "cucumber",
      "broccoli",
      "cauliflower",
      "spinach",
      "mushroom",
      "lemon",
      "lime",
    ],
  },
  {
    category: "Herbs",
    items: [
      "basil",
      "parsley",
      "cilantro",
      "rosemary",
      "thyme",
      "oregano",
      "dill",
      "mint",
      "sage",
      "chives",
      "tarragon",
      "bay leaf",
    ],
  },
  {
    category: "Spices",
    items: [
      "salt",
      "cumin",
      "paprika",
      "cinnamon",
      "black pepper",
      "chili powder",
      "turmeric",
      "coriander",
      "cayenne pepper",
      "nutmeg",
      "ginger",
      "cardamom",
      "cloves",
      "allspice",
    ],
  },
  {
    category: "Dairy & Eggs",
    items: [
      "milk",
      "egg",
      "butter",
      "ghee",
      "paneer",
      "heavy cream",
      "yogurt",
      "sour cream",
      "cheese",
      "cream cheese",
      "ricotta",
      "cottage cheese",
      "buttermilk",
      "half-and-half",
    ],
  },
  {
    category: "Proteins",
    items: [
      "chicken",
      "beef",
      "pork",
      "bacon",
      "turkey",
      "salmon",
      "shrimp",
      "tuna",
      "cod",
      "lamb",
      "sausage",
      "ham",
      "tofu",
      "tempeh",
    ],
  },
  {
    category: "Pantry & Grains",
    items: [
      "rice",
      "pasta",
      "quinoa",
      "oats",
      "bread",
      "tortilla",
      "beans",
      "lentils",
      "chickpea",
      "olive oil",
      "vegetable oil",
      "chicken broth",
      "stock",
      "beef broth",
      "peanut butter",
      "tomato paste",
      "canned tomato",
    ],
  },
  {
    category: "Baking",
    items: [
      "flour",
      "sugar",
      "brown sugar",
      "baking soda",
      "baking powder",
      "vanilla extract",
      "yeast",
      "cocoa powder",
      "chocolate chips",
      "powdered sugar",
      "cornstarch",
      "salt",
    ],
  },
  {
    category: "Condiments & Sauces",
    items: [
      "soy sauce",
      "ketchup",
      "mustard",
      "mayonnaise",
      "hot sauce",
      "worcestershire sauce",
      "vinegar",
      "balsamic vinegar",
      "fish sauce",
      "sriracha",
      "barbecue sauce",
      "salsa",
      "pesto",
      "tahini",
    ],
  },
];

export const CATALOG_ITEMS: string[] = CATALOG.flatMap((c) => c.items);

// Catalog items first, then the family's own past names, deduped case-insensitively.
export function mergeItemSuggestions(history: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...CATALOG_ITEMS, ...history]) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// item -> category, built once from CATALOG and keyed through normalizeItem so
// "garlic cloves", "Tomatoes" and "tomato" all land on the same entry.
// First entry wins. Different categories can normalize to the same key, for
// example Pantry's "canned tomato" loses its prep word and collides with
// Produce's "tomato". CATALOG is curated produce-first with the plainest form
// of a name earliest, so keeping the first match is the right tie-break.
const CATEGORY_BY_ITEM = new Map<string, string>();
for (const c of CATALOG) {
  for (const item of c.items) {
    const key = normalizeItem(item);
    if (key && !CATEGORY_BY_ITEM.has(key)) CATEGORY_BY_ITEM.set(key, c.category);
  }
}

// The order categories should appear in, which is the order they are curated in
// CATALOG: roughly a walk around a supermarket, produce first.
export const CATEGORY_ORDER: string[] = CATALOG.map((c) => c.category);

// Which aisle an ingredient belongs to. Derived, never stored: it is a fact
// about the ingredient, not about the recipe, so computing it on render can
// never go stale. Returns null for anything the catalog has not seen.
export function inferCategory(item: string): string | null {
  const key = normalizeItem(item);
  if (!key) return null;
  const direct = CATEGORY_BY_ITEM.get(key);
  if (direct) return direct;
  // A catalog term can sit at either end of a written ingredient: "smoked
  // paprika" is paprika (tail), "chicken thighs" is chicken (head). Take the
  // longest match either way, so "black pepper" beats "pepper" rather than
  // borrowing the aisle of "bell pepper". Tails are tried first because the
  // head noun of an English food name is usually last.
  let best: string | null = null;
  let bestLen = 0;
  for (const suffixFirst of [true, false]) {
    for (const [name, category] of CATEGORY_BY_ITEM) {
      const hit = suffixFirst ? key.endsWith(` ${name}`) : key.startsWith(`${name} `);
      if (hit && name.length > bestLen) {
        best = category;
        bestLen = name.length;
      }
    }
    if (best) return best;
  }
  return best;
}

// The aisle for an ingredient, honouring a family's own tag before the shared
// catalog. One place decides that precedence, so the grocery list and the
// recipe's category view can never disagree about where something belongs.
export function categoryFor(item: string, overrides?: Map<string, string>): string | null {
  const key = normalizeItem(item);
  if (key && overrides) {
    const own = overrides.get(key);
    if (own) return own;
  }
  return inferCategory(item);
}

// Common recipe parts, offered so a new recipe's Section dropdown is never
// empty. Deliberately parts of a recipe, never food categories: an aisle like
// "Produce" is a fact about an ingredient and belongs to the By category view,
// not written into a recipe. Curated and short; a family's own sections come
// from their history and quickly matter more than this list.
export const SECTION_SUGGESTIONS: string[] = [
  "For the marinade",
  "For the sauce",
  "For the dough",
  "For the filling",
  "For the topping",
  "For the dressing",
  "For the spice mix",
  "For serving",
  "Garnish",
];

// The family's own past sections first, then the common ones, deduped case
// insensitively. Mirrors mergeItemSuggestions: what you actually write beats
// what was guessed for you.
export function mergeSectionSuggestions(history: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...history, ...SECTION_SUGGESTIONS]) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  return out;
}
