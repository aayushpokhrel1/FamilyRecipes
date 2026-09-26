// Pure JSON-LD recipe parser. No Deno, DOM, or import statements so it runs
// unchanged under vitest (Node) and the Deno edge runtime.

export type Ingredient = { position: number; quantity: string | null; unit: string | null; item: string };
export type Step = { position: number; text: string };

export interface RecipeDraft {
  title: string;
  story: string;
  provenance: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  source_url: string | null;
}

// <script type="application/ld+json"> ... </script>, case-insensitive, any
// other attributes allowed, whitespace tolerated.
const SCRIPT_RE = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

// ISO-8601 duration, e.g. PT1H30M -> 90, PT20M -> 20, P1DT2H -> 1560.
const DURATION_RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i;

// Named HTML entities we care about. Keys are lowercase; lookups are
// case-insensitive on the name.
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201D",
  ldquo: "\u201C",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  deg: "\u00B0",
  ordm: "\u00BA",
  frac12: "\u00BD",
  frac14: "\u00BC",
  frac34: "\u00BE",
};

// Matches a named entity, a decimal numeric entity, or a hex numeric entity.
const ENTITY_RE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g;

// Non-breaking and other space-like characters that must become ordinary spaces.
const SPACE_LIKE_RE = /[\u00A0\u2007\u202F]/g;

// Decode HTML entities (named and numeric) in a single pass, fold non-breaking
// spaces into ordinary ones, then trim. Unknown entities are left verbatim.
export function cleanText(raw: string): string {
  const decoded = raw.replace(ENTITY_RE, (match, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number(dec) : parseInt(hex as string, 16);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    const value = NAMED_ENTITIES[(name as string).toLowerCase()];
    return value !== undefined ? value : match;
  });
  return decoded.replace(SPACE_LIKE_RE, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecipeNode(node: unknown): node is Record<string, unknown> {
  if (!isRecord(node)) return false;
  const type = node["@type"];
  if (typeof type === "string") return type === "Recipe";
  if (Array.isArray(type)) return type.some((t) => t === "Recipe");
  return false;
}

// The value itself, its array elements, and any @graph elements.
function candidateNodes(value: unknown): unknown[] {
  const nodes: unknown[] = [value];
  if (Array.isArray(value)) {
    for (const item of value) nodes.push(item);
  } else if (isRecord(value) && Array.isArray(value["@graph"])) {
    for (const item of value["@graph"]) nodes.push(item);
  }
  return nodes;
}

function findRecipeNode(html: string): Record<string, unknown> | null {
  SCRIPT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCRIPT_RE.exec(html)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue; // skip invalid JSON-LD blocks
    }
    for (const node of candidateNodes(parsed)) {
      if (isRecipeNode(node)) return node;
    }
  }
  return null;
}

function parseDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = DURATION_RE.exec(value.trim());
  if (!m) return null;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  const seconds = Number(m[4] ?? 0);
  const total = days * 1440 + hours * 60 + minutes + Math.floor(seconds / 60);
  return total > 0 ? total : null;
}

function parseServings(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string") {
    const m = /\d+/.exec(value);
    if (m) return Number(m[0]);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const n = parseServings(item);
      if (n !== null) return n;
    }
  }
  return null;
}

// schema.org gives ingredients as flat strings ("2 cups all-purpose flour"), so the fast
// path has to split them itself or the whole line lands in `item` and nothing scales.
// Same contract as prompt.ts: quantity is digits only, unit is singular and spelled out.
const UNITS: Record<string, string> = {
  tsp: "teaspoon", teaspoon: "teaspoon", teaspoons: "teaspoon",
  tbsp: "tablespoon", tbs: "tablespoon", tablespoon: "tablespoon", tablespoons: "tablespoon",
  c: "cup", cup: "cup", cups: "cup",
  oz: "ounce", ounce: "ounce", ounces: "ounce",
  lb: "pound", lbs: "pound", pound: "pound", pounds: "pound",
  g: "gram", gram: "gram", grams: "gram",
  kg: "kilogram", kilogram: "kilogram", kilograms: "kilogram",
  ml: "milliliter", milliliter: "milliliter", milliliters: "milliliter", millilitre: "milliliter", millilitres: "milliliter",
  l: "liter", liter: "liter", liters: "liter", litre: "liter", litres: "liter",
  qt: "quart", quart: "quart", quarts: "quart",
  pt: "pint", pint: "pint", pints: "pint",
  gal: "gallon", gallon: "gallon", gallons: "gallon",
  clove: "clove", cloves: "clove",
  can: "can", cans: "can",
  package: "package", packages: "package", pkg: "package",
  slice: "slice", slices: "slice",
  stick: "stick", sticks: "stick",
  bunch: "bunch", bunches: "bunch",
  sprig: "sprig", sprigs: "sprig",
  head: "head", heads: "head",
  stalk: "stalk", stalks: "stalk",
  pinch: "pinch", pinches: "pinch",
  dash: "dash", dashes: "dash",
  handful: "handful", handfuls: "handful",
};

// "1 1/2" | "1/2" | "1.5" | "2" | "1½" | "½"
const NUM = String.raw`\d+\s+\d+\/\d+|\d+\s*[¼-¾⅐-⅞]|\d+\/\d+|\d*\.\d+|\d+|[¼-¾⅐-⅞]`;
// A leading amount, optionally a range ("2-3", "2 to 3"), then an optional "(14-ounce)"
// size note, then an optional unit word. Everything after that is the item.
const LINE_RE = new RegExp(
  String.raw`^(${NUM})(?:\s*(?:-|–|to)\s*(${NUM}))?\s*(\([^)]*\)\s*)?([a-zA-Z]+\.?)?\s*(.*)$`,
);

export function splitIngredient(line: string): Omit<Ingredient, "position"> {
  const m = LINE_RE.exec(line);
  if (!m) return { quantity: null, unit: null, item: line };

  const [, lo, hi, note, word, rest] = m;
  const key = (word ?? "").replace(/\.$/, "").toLowerCase();
  const unit = UNITS[key] ?? null;
  // An unrecognized word was never a unit, so it belongs back on the front of the item.
  const item = [note?.trim(), unit ? "" : word, rest]
    .filter(Boolean).join(" ").replace(/^of\s+/i, "").replace(/\s+/g, " ").trim();

  return { quantity: hi ? `${lo}-${hi}` : lo, unit, item: item || line };
}

function parseIngredients(value: unknown): Ingredient[] {
  if (!Array.isArray(value)) return [];
  const out: Ingredient[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const line = cleanText(raw);
    if (!line) continue;
    out.push({ position: out.length, ...splitIngredient(line) });
  }
  return out;
}

function parseSteps(value: unknown): Step[] {
  const texts: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const text = cleanText(raw);
    if (text) texts.push(text);
  };
  if (typeof value === "string") {
    push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        push(entry);
      } else if (isRecord(entry)) {
        // HowToStep (and HowToSection's itemListElement) carry the text
        if (typeof entry.text === "string") {
          push(entry.text);
        } else if (Array.isArray(entry.itemListElement)) {
          for (const sub of entry.itemListElement) {
            if (isRecord(sub)) push(sub.text);
          }
        }
      }
    }
  }
  return texts.map((text, position) => ({ position, text }));
}

export function parseRecipeJsonLd(html: string): RecipeDraft | null {
  if (typeof html !== "string") return null;
  const node = findRecipeNode(html);
  if (!node) return null;

  return {
    title: typeof node.name === "string" ? cleanText(node.name) : "",
    story: typeof node.description === "string" ? cleanText(node.description) : "",
    provenance: "",
    servings: parseServings(node.recipeYield),
    prep_minutes: parseDuration(node.prepTime),
    cook_minutes: parseDuration(node.cookTime),
    ingredients: parseIngredients(node.recipeIngredient),
    steps: parseSteps(node.recipeInstructions),
    source_url: null,
  };
}
