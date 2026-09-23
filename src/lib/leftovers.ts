// One cook event feeding several slots: each leftover slot needs another
// serving-count's worth of food in the pot. Returns null when there is nothing
// honest to suggest, so the UI shows no nudge rather than a made-up number.
export function suggestedServings(base: number | null, leftoverCount: number): number | null {
  if (base === null || base <= 0 || leftoverCount <= 0) return null;
  return base * (1 + leftoverCount);
}
