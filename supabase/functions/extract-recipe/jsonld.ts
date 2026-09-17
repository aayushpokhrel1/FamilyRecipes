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

function parseIngredients(value: unknown): Ingredient[] {
  if (!Array.isArray(value)) return [];
  const out: Ingredient[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const item = raw.trim();
    if (!item) continue;
    out.push({ position: out.length, quantity: null, unit: null, item });
  }
  return out;
}

function parseSteps(value: unknown): Step[] {
  const texts: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const text = raw.trim();
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
    title: typeof node.name === "string" ? node.name : "",
    story: typeof node.description === "string" ? node.description : "",
    provenance: "",
    servings: parseServings(node.recipeYield),
    prep_minutes: parseDuration(node.prepTime),
    cook_minutes: parseDuration(node.cookTime),
    ingredients: parseIngredients(node.recipeIngredient),
    steps: parseSteps(node.recipeInstructions),
    source_url: null,
  };
}
