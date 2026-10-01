// When the second provider is worth trying. No Deno or DOM specifics so it runs unchanged
// under vitest (Node) and the Deno edge runtime, the same arrangement as retry.ts, jsonld.ts,
// htmlText.ts and errors.ts.
//
// This is a predicate rather than an `if` buried in the handler because getting it wrong is
// invisible: a fallback that is skipped when it should fire looks exactly like a provider
// outage, and one that fires when it cannot help wastes a call and reports the WRONG error.

import { RETRY_STATUSES } from "./retry.ts";

// Only an explicit opt-in counts. Defaulting to "assume it can see" would mean every photo
// extraction that falls back spends a request to be told the model has no vision, and then
// reports that confusing 400 instead of the real reason the first provider failed. The
// conservative default is also the honest one: we cannot detect vision support, only be told.
export function parseVisionFlag(raw: string | undefined | null): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export type FallbackDecision = { try: boolean; reason: string };

export function shouldTryFallback(opts: {
  ok: boolean;
  status: number;
  mode: string;
  hasFallback: boolean;
  fallbackSeesImages: boolean;
}): FallbackDecision {
  if (opts.ok) return { try: false, reason: "primary succeeded" };
  if (!opts.hasFallback) return { try: false, reason: "no fallback configured" };
  // A 400 or a 401 is OUR bug or OUR key, so a second provider fails the same way and the
  // first error is the useful one. Same reasoning as RETRY_STATUSES in retry.ts.
  if (!RETRY_STATUSES.has(opts.status)) {
    return { try: false, reason: `status ${opts.status} will not fix itself` };
  }
  // The defence this file exists for: a text-only fallback cannot read a photograph.
  if (opts.mode === "image" && !opts.fallbackSeesImages) {
    return { try: false, reason: "fallback has no vision, set FALLBACK_MODEL_VISION to use it for photos" };
  }
  return { try: true, reason: `primary returned ${opts.status}` };
}
