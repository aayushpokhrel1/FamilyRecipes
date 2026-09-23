// Pure unit conversion for grocery merging. No app imports.
// Metric and imperial are separate families on purpose: cross-system
// conversion would render "0.42 cups" from millilitres and nothing here
// needs it. Volume and weight never merge, that needs per-ingredient density.
export type UnitFamily =
  | "volume-imperial" | "volume-metric" | "weight-imperial" | "weight-metric";

const ALIASES: Record<string, string> = {
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", t: "tsp",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp",
  "fl oz": "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
  cup: "cup", cups: "cup", c: "cup",
  pint: "pint", pints: "pint", pt: "pint",
  quart: "quart", quarts: "quart", qt: "quart",
  gallon: "gallon", gallons: "gallon", gal: "gallon",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  g: "g", gram: "g", grams: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
};

// value of one unit expressed in its family's base unit
const IN_BASE: Record<string, number> = {
  tsp: 1, tbsp: 3, "fl oz": 6, cup: 48, pint: 96, quart: 192, gallon: 768,
  ml: 1, l: 1000,
  oz: 1, lb: 16,
  g: 1, kg: 1000,
};

const FAMILY_OF: Record<string, UnitFamily> = {
  tsp: "volume-imperial", tbsp: "volume-imperial", "fl oz": "volume-imperial",
  cup: "volume-imperial", pint: "volume-imperial", quart: "volume-imperial",
  gallon: "volume-imperial",
  ml: "volume-metric", l: "volume-metric",
  oz: "weight-imperial", lb: "weight-imperial",
  g: "weight-metric", kg: "weight-metric",
};

// Largest first, but only the units recipes actually use. "fl oz", "pint",
// "quart" and "gallon" are parsed but never displayed: a strict size ordering
// would render 18 tsp as "3 fl oz" and 96 tsp as "1 pint", where a cook expects
// "6 tbsp" and "2 cups". Parsing and display are different lists on purpose.
const DISPLAY_LADDER: Record<UnitFamily, string[]> = {
  "volume-imperial": ["cup", "tbsp", "tsp"],
  "volume-metric": ["l", "ml"],
  "weight-imperial": ["lb", "oz"],
  "weight-metric": ["kg", "g"],
};

export function normalizeUnit(unit: string | null): string | null {
  if (!unit) return null;
  const s = unit.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return ALIASES[s] ?? null;
}

export function unitFamily(unit: string | null): UnitFamily | null {
  const u = normalizeUnit(unit);
  return u ? FAMILY_OF[u] ?? null : null;
}

export function toBase(value: number, unit: string): number | null {
  const u = normalizeUnit(unit);
  if (!u) return null;
  const factor = IN_BASE[u];
  return factor === undefined ? null : value * factor;
}

export function fromBase(base: number, family: UnitFamily): { value: number; unit: string } {
  const ladder = DISPLAY_LADDER[family];
  for (const unit of ladder) {
    const value = base / IN_BASE[unit];
    if (value >= 1) return { value, unit };
  }
  const smallest = ladder[ladder.length - 1];
  return { value: base / IN_BASE[smallest], unit: smallest };
}
