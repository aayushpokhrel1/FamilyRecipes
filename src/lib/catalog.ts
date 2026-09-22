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
