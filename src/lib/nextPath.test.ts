import { describe, expect, it } from "vitest";
import { safeNext, withNext } from "./nextPath";

describe("safeNext", () => {
  it("keeps a path inside this app", () => {
    expect(safeNext("/join/abc123")).toBe("/join/abc123");
    expect(safeNext("/recipes/1?scale=2")).toBe("/recipes/1?scale=2");
  });

  it("refuses anything a browser would read as another host", () => {
    // The parameter comes off a URL anyone can write, so these are the attack, not typos:
    // each one would turn our own sign-in page into a redirector to someone else's.
    for (const hostile of [
      "https://evil.example/login",
      "//evil.example",
      String.raw`/\evil.example`,
      "javascript:alert(1)",
      "evil.example",
      "/join\nLocation: https://evil.example",
    ]) {
      expect(safeNext(hostile)).toBeNull();
    }
  });

  it("treats nothing as nowhere in particular", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext("")).toBeNull();
  });
});

describe("withNext", () => {
  it("encodes the destination so a path with its own query survives", () => {
    expect(withNext("/signin", "/join/abc")).toBe("/signin?next=%2Fjoin%2Fabc");
    expect(withNext("/signin", "/recipes/1?scale=2")).toBe(
      "/signin?next=%2Frecipes%2F1%3Fscale%3D2",
    );
  });

  it("leaves a bare auth URL alone when there is nowhere to go back to", () => {
    expect(withNext("/signin", null)).toBe("/signin");
    expect(withNext("/signin", "https://evil.example")).toBe("/signin");
  });
});
