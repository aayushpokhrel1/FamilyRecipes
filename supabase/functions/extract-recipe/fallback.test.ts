import { describe, it, expect } from "vitest";
import { parseVisionFlag, shouldTryFallback } from "./fallback";

const base = { ok: false, status: 503, mode: "text", hasFallback: true, fallbackSeesImages: false };

describe("parseVisionFlag", () => {
  it("accepts the obvious truthy spellings", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on", " true "]) {
      expect(parseVisionFlag(v)).toBe(true);
    }
  });

  // The conservative default IS the feature: we cannot detect vision support, only be told.
  it("treats anything else, including unset, as no vision", () => {
    for (const v of [undefined, null, "", "false", "0", "no", "maybe", "vision"]) {
      expect(parseVisionFlag(v)).toBe(false);
    }
  });
});

describe("shouldTryFallback", () => {
  it("does not fire when the primary succeeded", () => {
    expect(shouldTryFallback({ ...base, ok: true, status: 200 }).try).toBe(false);
  });

  it("does not fire when no fallback is configured", () => {
    expect(shouldTryFallback({ ...base, hasFallback: false }).try).toBe(false);
  });

  it("fires on the statuses that can fix themselves", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(shouldTryFallback({ ...base, status }).try).toBe(true);
    }
  });

  // A second provider cannot fix our own bug or our own key, and the first error is the one
  // worth reporting.
  it("does not fire on our own bugs or our own key", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const d = shouldTryFallback({ ...base, status });
      expect(d.try).toBe(false);
      expect(d.reason).toMatch(/will not fix itself/);
    }
  });

  // THE DEFENCE THIS FILE EXISTS FOR, added before it bit rather than after: DeepSeek has no
  // vision, so a photo falling back to it would spend a request to earn a 400 and then report
  // that instead of the real reason the first provider failed.
  it("does not send a photo to a fallback that cannot see", () => {
    const d = shouldTryFallback({ ...base, mode: "image" });
    expect(d.try).toBe(false);
    expect(d.reason).toMatch(/FALLBACK_MODEL_VISION/);
  });

  it("does send a photo to a fallback that can see", () => {
    expect(shouldTryFallback({ ...base, mode: "image", fallbackSeesImages: true }).try).toBe(true);
  });

  // The vision flag must not quietly gate the modes it has nothing to do with.
  it("ignores the vision flag for text, url and audio", () => {
    for (const mode of ["text", "url", "audio"]) {
      expect(shouldTryFallback({ ...base, mode, fallbackSeesImages: false }).try).toBe(true);
    }
  });

  it("always explains itself, so the logs say why nothing was tried", () => {
    for (const d of [
      shouldTryFallback({ ...base, ok: true }),
      shouldTryFallback({ ...base, hasFallback: false }),
      shouldTryFallback({ ...base, status: 400 }),
      shouldTryFallback({ ...base, mode: "image" }),
      shouldTryFallback(base),
    ]) {
      expect(d.reason).toBeTruthy();
    }
  });
});
