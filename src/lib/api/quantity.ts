// Pure parsing/scaling for freeform ingredient quantities. No app imports.
// The foundation for portions scaling. ponytail: heuristic parsing only; it
// handles the common freeform shapes (ints, decimals, fractions, mixed numbers,
// unicode fractions, and simple ranges) and returns null for anything else.
export interface QtyRange {
  min: number;
  max: number;
  // Trailing text that followed the number ("tablespoons", "28-ounce can").
  // Present when the quantity field carried more than a bare amount, which
  // voice extraction sometimes produces. Scaling leaves it untouched.
  suffix?: string;
}

// half, third, quarter, three-quarters, two-thirds
const UNICODE_FRACTIONS: Record<string, number> = {
  "\u00BD": 0.5,
  "\u2153": 0.3333333333,
  "\u00BC": 0.25,
  "\u00BE": 0.75,
  "\u2154": 0.6666666667,
};

const COMMON_FRACTIONS: Array<[number, string]> = [
  [0.25, "1/4"],
  [0.3333333333, "1/3"],
  [0.5, "1/2"],
  [0.6666666667, "2/3"],
  [0.75, "3/4"],
];

// Parse a single value: integer, decimal, fraction, mixed number, or unicode
// fraction (optionally preceded by a whole number).
function parseSingle(text: string): number | null {
  const s = text.trim();
  if (!s) return null;

  const unicodeMatch = s.match(
    /^(\d+(?:\.\d+)?)?\s*([\u00BD\u2153\u00BC\u00BE\u2154])$/,
  );
  if (unicodeMatch) {
    const whole = unicodeMatch[1] ? Number(unicodeMatch[1]) : 0;
    return whole + UNICODE_FRACTIONS[unicodeMatch[2]];
  }

  const mixedMatch = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedMatch) {
    const denom = Number(mixedMatch[3]);
    if (denom === 0) return null;
    return Number(mixedMatch[1]) + Number(mixedMatch[2]) / denom;
  }

  const fractionMatch = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fractionMatch) {
    const denom = Number(fractionMatch[2]);
    if (denom === 0) return null;
    return Number(fractionMatch[1]) / denom;
  }

  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);

  return null;
}

// Split "2-3" or "2 to 3" into its two halves, or null if it is not a range.
function splitRange(s: string): [string, string] | null {
  const dash = s.indexOf("-");
  if (dash > 0 && dash < s.length - 1) {
    return [s.slice(0, dash), s.slice(dash + 1)];
  }
  const toMatch = s.match(/^(.*?)\s+to\s+(.*)$/);
  if (toMatch) return [toMatch[1], toMatch[2]];
  return null;
}

// Numeric-ish leading tokens: digits, fractions, unicode fractions, ranges,
// plus "to" as a range word. Anything else ends the quantity.
const NUMERIC_TOKEN = /^[\d./½⅓¼¾⅔-]+$/;

// Split "2 tablespoons" into ["2", "tablespoons"], or null if it does not start
// with a number.
function splitLeadingNumber(s: string): [string, string] | null {
  const tokens = s.split(/\s+/);
  let taken = 0;
  while (
    taken < tokens.length &&
    (NUMERIC_TOKEN.test(tokens[taken]) || tokens[taken].toLowerCase() === "to")
  ) {
    taken++;
  }
  while (taken > 0 && tokens[taken - 1].toLowerCase() === "to") taken--;
  if (taken === 0 || taken === tokens.length) return null;
  return [tokens.slice(0, taken).join(" "), tokens.slice(taken).join(" ")];
}

function parseExact(s: string): QtyRange | null {
  const range = splitRange(s);
  if (range) {
    const min = parseSingle(range[0]);
    const max = parseSingle(range[1]);
    if (min !== null && max !== null) return { min, max };
  }

  const single = parseSingle(s);
  return single !== null ? { min: single, max: single } : null;
}

export function parseQuantity(text: string | null): QtyRange | null {
  if (text === null) return null;
  const s = text.trim();
  if (!s) return null;

  const exact = parseExact(s);
  if (exact) return exact;

  const split = splitLeadingNumber(s);
  if (!split) return null;
  const leading = parseExact(split[0]);
  return leading ? { ...leading, suffix: split[1] } : null;
}

export function formatQuantity(n: number): string {
  if (!Number.isFinite(n)) return String(n);

  const whole = Math.floor(n);
  const frac = n - whole;

  const candidates: Array<[number, string]> = [[0, ""], ...COMMON_FRACTIONS, [1, ""]];
  let bestValue = 0;
  let bestLabel = "";
  let bestDiff = Infinity;
  for (const [value, label] of candidates) {
    const diff = Math.abs(frac - value);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestValue = value;
      bestLabel = label;
    }
  }

  if (bestDiff <= 0.02) {
    if (bestValue === 0) return String(whole);
    if (bestValue === 1) return String(whole + 1);
    return whole > 0 ? `${whole} ${bestLabel}` : bestLabel;
  }

  return String(Number(n.toFixed(2)));
}

export function scaleIngredientQty(
  quantity: string | null,
  factor: number,
): string | null {
  if (quantity === null) return null;
  if (!Number.isFinite(factor) || factor <= 0) return quantity;

  const parsed = parseQuantity(quantity);
  if (parsed === null) return quantity;

  const scaled =
    parsed.min === parsed.max
      ? formatQuantity(parsed.min * factor)
      : `${formatQuantity(parsed.min * factor)}-${formatQuantity(parsed.max * factor)}`;
  return parsed.suffix ? `${scaled} ${parsed.suffix}` : scaled;
}
