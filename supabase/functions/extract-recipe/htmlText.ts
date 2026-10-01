// Turn a fetched HTML page into the smallest text that still contains the recipe. No Deno or
// DOM specifics so it runs unchanged under vitest (Node) and the Deno edge runtime, the same
// arrangement as jsonld.ts and retry.ts.
//
// WHY THIS EXISTS: the url mode used to send the ENTIRE raw page to the model. A recipe page
// is mostly inline scripts, CSS and tracking, so that was hundreds of thousands of input
// tokens for a recipe worth a few hundred, which exhausted a per-minute input-token quota in
// ONE request (a real 429 on 2026-09-30) and would simply exceed the context window of most
// other models. Trimming is not an optimisation here, it is what makes the path work at all.

// A cap, not a target: enough for a long recipe page's visible text, small enough that no
// provider's context window or per-minute quota is the binding constraint.
export const MAX_INPUT_CHARS = 12000;

// Script contents are dropped EXCEPT ld+json. Modern recipe sites put the recipe itself in a
// script tag, so a naive "strip all scripts" can remove the only copy of the content: a page
// measured on 2026-09-30 stripped to literally zero characters that way. jsonld.ts gets first
// refusal on those blocks, and this keeps them as text for the model when it declines.
const KEEP_SCRIPT = /application\/ld\+json/i;

function scriptBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (KEEP_SCRIPT.test(m[1] ?? "")) out.push(m[2] ?? "");
  }
  return out;
}

export function htmlToText(html: string, maxChars: number = MAX_INPUT_CHARS): string {
  const kept = scriptBlocks(html);

  let s = html;
  // Order matters: remove whole elements whose CONTENT is never recipe text before the
  // generic tag strip, or their bodies survive as prose.
  s = s.replace(/<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Block-level tags become newlines so ingredient lists do not run together into one line,
  // which is the difference between a model reading a list and reading a sentence.
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*>/gi, "\n");
  s = s.replace(/<br\b[^>]*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v ]+/g, " ");
  s = s.replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // ld+json first: it is structured, so it is worth more per character than the page prose,
  // and it must not be the part that gets cut by the cap.
  const parts = [...kept.map((k) => k.trim()).filter(Boolean), s].filter(Boolean);
  const joined = parts.join("\n\n");
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}

// Just the handful that actually appear in recipe text. A full entity table would be dead
// weight: anything missed reads as a literal &ldquo; to the model, which is survivable, where
// a missing fraction or degree sign is not.
const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&nbsp;": " ", "&deg;": "°", "&frac12;": "1/2", "&frac14;": "1/4", "&frac34;": "3/4",
  "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"', "&ndash;": "-", "&mdash;": "-",
};

function decodeEntities(s: string): string {
  let out = s.replace(/&(amp|lt|gt|quot|apos|nbsp|deg|frac12|frac14|frac34|rsquo|lsquo|ldquo|rdquo|ndash|mdash|#39);/g,
    (m) => ENTITIES[m] ?? m);
  // Numeric entities cover the rest, including the fraction glyphs recipe sites love.
  out = out.replace(/&#(\d+);/g, (_, d) => {
    const code = Number(d);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });
  return out;
}
